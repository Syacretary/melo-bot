const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage,
    proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs-extra');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const Groq = require('groq-sdk');
const mime = require('mime-types');
const express = require('express');

const config = require('./config');
const toolHandler = require('./lib/toolHandler');
const contextManager = require('./lib/contextManager');
const ragHandler = require('./lib/ragHandler');
const groqHandler = require('./lib/groqHandler');
const reminderService = require('./lib/reminderService');
const statsTracker = require('./lib/statsTracker');
const recapManager = require('./lib/recapManager');
const { parseMarkdownToWhatsApp } = require('./lib/markdownParser');

// --- INITIALIZATION ---
const TEMP_DIR = path.join(__dirname, 'temp_files');
const SESSION_DIR = path.join(__dirname, 'session');
fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(SESSION_DIR);

const logger = pino({
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
    }
});

// --- HTTP SERVER (Anti-Sleep) ---
const app = express();
const PORT = process.env.PORT || 7860;
app.get('/', (req, res) => res.send('Bot Melo is Live!'));
app.listen(PORT, () => logger.info(`Health check server running on port ${PORT}`));

// AI Setup
const genAI = new GoogleGenerativeAI(config.ai.google.apiKey);
const groq = new Groq({ apiKey: config.ai.groq.apiKey });
const model = genAI.getGenerativeModel({
    model: config.ai.google.model,
    tools: toolHandler.getTools()
});

const pendingDocumentContexts = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();
    
    logger.info(`Starting WhatsApp Bot v${version.join('.')}...`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : null;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            logger.error(`Connection closed: ${lastDisconnect.error?.message}. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) setTimeout(startBot, 10000);
        } else if (connection === 'open') {
            logger.info('SUCCESS: Bot is online and connected!');
            reminderService.init(sock);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            try {
                if (!msg.message || msg.key.fromMe) continue;
                const remoteJid = msg.key.remoteJid;
                if (remoteJid?.endsWith('@newsletter')) continue;

                const pushName = msg.pushName || 'User';
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
                const isImage = !!msg.message.imageMessage;
                const isVideo = !!msg.message.videoMessage;
                const isSticker = !!msg.message.stickerMessage;
                const documentMessage = msg.message.documentMessage;

                logger.info({ event: 'INCOMING', from: pushName, chat: remoteJid, text: text.slice(0, 50) });
                
                statsTracker.addActivity(remoteJid, 'user', text);

                if (recapManager.isInRecap(remoteJid)) {
                    const nextStep = await recapManager.getNextStep(remoteJid, text);
                    if (nextStep) return await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(nextStep) });
                }

                if (text.toLowerCase() === '.recap') {
                    const intro = await recapManager.initiateRecap(remoteJid, 'monthly');
                    return await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(intro || "_Belum ada data yang cukup._") });
                }

                if (text.toLowerCase() === '.newchat') {
                    contextManager.clearHistory(remoteJid);
                    return await sock.sendMessage(remoteJid, { text: "_Konteks percakapan telah dihapus._" });
                }

                if (documentMessage) {
                    await handleDocument(sock, msg, documentMessage);
                    continue;
                }

                if (text.startsWith('.sticker') || text.startsWith('.stiker')) {
                    await handleStickerCommand(sock, msg);
                    continue;
                }

                if (!text && !isImage && !isVideo && !isSticker) continue;

                let finalUserText = text;
                if (pendingDocumentContexts.has(remoteJid)) {
                    finalUserText = `Ini adalah isi dokumen yang saya miliki:\n'${pendingDocumentContexts.get(remoteJid)}'\n${text || "Jelaskan isi dokumen ini."}`;
                    pendingDocumentContexts.delete(remoteJid);
                }

                if (isSticker) {
                    finalUserText = `[Sticker Received] ${text || "Berikan respon interaktif terhadap stiker ini."}`;
                }

                let mediaParts = [];
                let currentMediaPath = null;
                if (isImage || isVideo || isSticker) {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const mimeType = isImage ? 'image/jpeg' : (isVideo ? 'video/mp4' : 'image/webp');
                    mediaParts.push({ inlineData: { data: buffer.toString('base64'), mimeType } });
                    currentMediaPath = path.join(TEMP_DIR, `in_${Date.now()}.${mimeType.split('/')[1]}`);
                    fs.writeFileSync(currentMediaPath, buffer);
                }

                contextManager.addMessage(remoteJid, finalUserText, 'user');
                await sock.sendPresenceUpdate('composing', remoteJid);

                try {
                    let textResponse = await processWithGemini(sock, msg, remoteJid, text, mediaParts, currentMediaPath);
                    if (textResponse) {
                        contextManager.addMessage(remoteJid, textResponse, 'model');
                        await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(textResponse) });
                    }
                } catch (e) {
                    logger.warn("Gemini Failed, trying Groq Fallback...");
                    const fallback = await processWithGroq(sock, msg, remoteJid, finalUserText);
                    if (fallback) {
                        contextManager.addMessage(remoteJid, fallback, 'model');
                        await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(fallback) });
                    }
                } finally {
                    if (currentMediaPath && fs.existsSync(currentMediaPath)) fs.unlinkSync(currentMediaPath);
                }
            } catch (err) { logger.error(err); }
        }
    });
}

async function processWithGemini(sock, msg, remoteJid, text, mediaParts, currentMediaPath) {
    const history = contextManager.getHistory(remoteJid);
    const chat = model.startChat({ history: history.slice(0, -1) });
    const messageParts = text ? [text, ...mediaParts] : mediaParts;
    let result = await chat.sendMessage(messageParts.length > 0 ? messageParts : "Analyze this.");
    let response = await result.response;
    let functionCalls = response.functionCalls();
    
    if (functionCalls) {
        for (const call of functionCalls) {
            const { name, args } = call;
            if (name === 'webSearch') await sock.sendMessage(remoteJid, { text: `> _Mencari di Google..._` });
            if (name === 'stickerMaker') await sock.sendMessage(remoteJid, { text: `> _Membuat stiker..._` });
            if (name === 'imageGenerator') await sock.sendMessage(remoteJid, { text: `> _Membuat gambar..._` });
            if (['fileGenerator', 'fileConverter'].includes(name)) await sock.sendMessage(remoteJid, { text: `> _Membuat file..._` });

            const toolResult = await toolHandler.executeTool(name, args, { remoteJid, filePath: currentMediaPath });
            
            if (name === 'imageGenerator' && toolResult.success) await sock.sendMessage(remoteJid, { image: { url: toolResult.imageUrl }, caption: `_Generated by ${toolResult.modelUsed}_` });
            if (['fileGenerator', 'fileConverter'].includes(name) && toolResult.success) {
                await sock.sendMessage(remoteJid, { document: { url: toolResult.filePath }, mimetype: mime.lookup(toolResult.filePath), fileName: path.basename(toolResult.filePath) });
            }
            if (name === 'stickerMaker' && toolResult.success) await sock.sendMessage(remoteJid, { sticker: { url: toolResult.stickerPath } });

            result = await chat.sendMessage([{ functionResponse: { name, response: { content: toolResult } } }]);
            response = await result.response;
        }
    }
    return response.text();
}

async function processWithGroq(sock, msg, remoteJid, text) {
    const history = contextManager.getHistory(remoteJid);
    const groqMessages = history.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.parts[0].text }));
    const completion = await groq.chat.completions.create({ messages: groqMessages, model: "llama-3.3-70b-versatile" });
    return completion.choices[0]?.message?.content || "Gagal merespon.";
}

async function handleStickerCommand(sock, msg) {
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const tempPath = path.join(TEMP_DIR, `stk_${Date.now()}.webp`);
        fs.writeFileSync(tempPath, buffer);
        const result = await toolHandler.executeTool('stickerMaker', { target: 'auto' }, { filePath: tempPath, mimeType: 'image/webp' });
        if (result.success) await sock.sendMessage(msg.key.remoteJid, { sticker: { url: result.stickerPath } });
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) { logger.error(e); }
}

async function handleDocument(sock, msg, docMsg) {
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const tempPath = path.join(TEMP_DIR, docMsg.fileName);
        fs.writeFileSync(tempPath, buffer);
        const text = await ragHandler.extractText(tempPath, docMsg.mimetype);
        if (text) {
            const analysis = await groqHandler.analyzeDocument(text, "Buat rangkuman detail.");
            pendingDocumentContexts.set(msg.key.remoteJid, analysis);
            await sock.sendMessage(msg.key.remoteJid, { text: `> _Dokumen "${docMsg.fileName}" selesai dibaca. Mau di apain?_` });
        }
        fs.unlinkSync(tempPath);
    } catch (e) { logger.error(e); }
}

startBot().catch(e => logger.error(e));