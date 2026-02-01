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

// --- HTTP SERVER (Health Check for Zeabur) ---
const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (req, res) => res.send('Melo Bot is Active!'));
app.listen(PORT, () => logger.info(`Health check server active on port ${PORT}`));

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
        connectTimeoutMs: 60000
    });

    // --- PAIRING CODE LOGIC ---
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER || config.phoneNumber;
        if (phoneNumber) {
            logger.info(`Requesting Pairing Code for: ${phoneNumber} in 10s...`);
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
                    console.log('\n' + '='.repeat(40));
                    console.log(`🚀 YOUR PAIRING CODE: ${code}`);
                    console.log('='.repeat(40) + '\n');
                } catch (e) {
                    logger.error(`Failed to get pairing code: ${e.message}`);
                    logger.info('Retrying Pairing Code request...');
                    // Clear session and restart if it persists
                    if (e.message.includes('Closed')) {
                        fs.emptyDirSync(SESSION_DIR);
                        startBot();
                    }
                }
            }, 10000); // Increased delay to 10s
        } else {
            logger.warn('No Phone Number found for Pairing Code.');
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : null;
            
            // Force reconnect except for explicit logout
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            logger.error(`Connection closed: ${lastDisconnect.error?.message}. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            } else {
                logger.fatal('Logged out. Clearing session for new login...');
                fs.emptyDirSync(SESSION_DIR);
                startBot();
            }
        } else if (connection === 'open') {
            logger.info('SUCCESS: Connected to WhatsApp!');
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
                
                // Track stats
                statsTracker.addActivity(remoteJid, 'user', text);

                // Recap Handler
                if (recapManager.isInRecap(remoteJid)) {
                    const nextText = await recapManager.getNextStep(remoteJid, text);
                    if (nextText) return await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(nextText) });
                }

                // Command Handler
                const cleanText = text.toLowerCase().trim();
                if (cleanText === '.recap') {
                    const intro = await recapManager.initiateRecap(remoteJid, 'monthly');
                    return await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(intro || "_Data belum cukup._") });
                }
                if (cleanText === '.newchat') {
                    contextManager.clearHistory(remoteJid);
                    return await sock.sendMessage(remoteJid, { text: "_Brain reset. Mari mulai dari nol!_" });
                }
                if (cleanText.startsWith('.sticker') || cleanText.startsWith('.stiker')) {
                    await handleStickerCommand(sock, msg);
                    continue;
                }

                if (documentMessage) {
                    await handleDocument(sock, msg, documentMessage);
                    continue;
                }

                if (!text && !isImage && !isVideo && !isSticker) continue;

                // Context Preparation
                let finalUserText = text;
                if (pendingDocumentContexts.has(remoteJid)) {
                    finalUserText = `Ini adalah isi dokumen yang saya miliki:
'${pendingDocumentContexts.get(remoteJid)}'
${text || "Jelaskan isi dokumen ini."}`;
                    pendingDocumentContexts.delete(remoteJid);
                }
                if (isSticker) finalUserText = `[User sent a sticker] ${text || "Berikan respon singkat dan asik tentang stiker ini."}`;

                // Media Download
                let mediaParts = [];
                let currentMediaPath = null;
                if (isImage || isVideo || isSticker) {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const mimeType = isImage ? 'image/jpeg' : (isVideo ? 'video/mp4' : 'image/webp');
                    mediaParts.push({ inlineData: { data: buffer.toString('base64'), mimeType } });
                    
                    currentMediaPath = path.join(TEMP_DIR, `in_${Date.now()}.${isImage?'jpg':(isVideo?'mp4':'webp')}`);
                    fs.writeFileSync(currentMediaPath, buffer);
                }

                // AI Engine
                contextManager.addMessage(remoteJid, finalUserText, 'user');
                await sock.sendPresenceUpdate('composing', remoteJid);

                try {
                    let textResponse = await processWithGemini(sock, msg, remoteJid, finalUserText, mediaParts, currentMediaPath);
                    if (textResponse) {
                        contextManager.addMessage(remoteJid, textResponse, 'model');
                        await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(textResponse) });
                    }
                } catch (e) {
                    logger.warn({ event: 'GEMINI_FAIL', error: e.message });
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
    let result = await chat.sendMessage(messageParts.length > 0 ? messageParts : "Respon.");
    let response = await result.response;
    let functionCalls = response.functionCalls();
    
    if (functionCalls) {
        for (const call of functionCalls) {
            const { name, args } = call;
            // Visual indicators
            if (name === 'webSearch') await sock.sendMessage(remoteJid, { text: `> _Mencari di Google..._` });
            if (name === 'stickerMaker') await sock.sendMessage(remoteJid, { text: `> _Membuat stiker..._` });
            if (name === 'imageGenerator') await sock.sendMessage(remoteJid, { text: `> _Membuat gambar..._` });
            if (['fileGenerator', 'fileConverter'].includes(name)) await sock.sendMessage(remoteJid, { text: `> _Memproses file..._` });

            const toolResult = await toolHandler.executeTool(name, args, { remoteJid, filePath: currentMediaPath });
            
            // Handle specific tool outputs
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
    const groqMessages = history.map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user', 
        content: m.parts[0].text 
    }));
    const completion = await groq.chat.completions.create({ messages: groqMessages, model: "llama-3.3-70b-versatile" });
    return completion.choices[0]?.message?.content || "Maaf, saya sedang tidak bisa berpikir.";
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
            const analysis = await groqHandler.analyzeDocument(text, "Berikan rangkuman dokumen ini secara cerdas.");
            pendingDocumentContexts.set(msg.key.remoteJid, analysis);
            await sock.sendMessage(msg.key.remoteJid, { text: `> _Dokumen "${docMsg.fileName}" selesai dibaca. Mau diapakan?_` });
        }
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) { logger.error(e); }
}

startBot().catch(e => logger.error({ event: 'CRASH', error: e.message }));
