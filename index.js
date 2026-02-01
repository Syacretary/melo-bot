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
const dns = require('dns');

// --- DNS-over-HTTPS (DoH) Bridge ---
// This bypasses strict cloud DNS restrictions by fetching IPs over HTTPS (Port 443)
const originalLookup = dns.lookup;
const dnsCache = new Map();

async function resolveDoH(hostname) {
    if (dnsCache.has(hostname)) return dnsCache.get(hostname);
    try {
        // Use Cloudflare DNS-over-HTTPS API
        const res = await axios.get(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
            headers: { 'accept': 'application/dns-json' },
            timeout: 5000
        });
        const ip = res.data.Answer?.find(a => a.type === 1)?.data;
        if (ip) {
            dnsCache.set(hostname, ip);
            return ip;
        }
    } catch (err) {
        // Fallback silently
    }
    return null;
}

dns.lookup = async (hostname, options, callback) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    // Intercept WhatsApp domains
    if (hostname.includes('whatsapp.net') || hostname.includes('whatsapp.com')) {
        const ip = await resolveDoH(hostname);
        if (ip) {
            return callback(null, ip, 4);
        }
    }
    
    return originalLookup(hostname, options, callback);
};

// Also patch dns.promises.lookup for modern libraries
const originalLookupPromise = dns.promises.lookup;
dns.promises.lookup = async (hostname, options) => {
    if (hostname.includes('whatsapp.net') || hostname.includes('whatsapp.com')) {
        const ip = await resolveDoH(hostname);
        if (ip) return { address: ip, family: 4 };
    }
    return originalLookupPromise(hostname, options);
};

const config = require('./config');

async function testDNS() {
    return new Promise((resolve) => {
        dns.lookup('web.whatsapp.com', (err, address) => {
            if (err) {
                logger.error(`DNS Diagnostic Failed: ${err.message}`);
                resolve(false);
            } else {
                logger.info(`DNS Diagnostic Success: web.whatsapp.com resolved to ${address}`);
                resolve(true);
            }
        });
    });
}
const app = express();
const PORT = process.env.PORT || 7860; // Port default Hugging Face

app.get('/', (req, res) => {
    res.send('Bot WhatsApp is running perfectly!');
});

app.listen(PORT, () => {
    logger.info(`HTTP Server is active on port ${PORT}`);
});

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
const DOC_STORE_DIR = path.join(__dirname, 'session/doc_store');

fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(SESSION_DIR);
fs.ensureDirSync(DOC_STORE_DIR);

// Clear temp files on startup
fs.emptyDirSync(TEMP_DIR);

// Enhanced Logger
const logger = pino({
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
    }
});

// AI Setup
const genAI = new GoogleGenerativeAI(config.ai.google.apiKey);
const groq = new Groq({ apiKey: config.ai.groq.apiKey });

const pendingDocumentContexts = new Map();
const model = genAI.getGenerativeModel({
    model: config.ai.google.model,
    tools: toolHandler.getTools()
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    logger.info(`Starting WhatsApp Bot v${version.join('.')} (Production Mode)`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: config.whatsapp.authType !== 'pairing',
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            // This helps with downloading quoted media
            return proto.Message.fromObject({});
        }
    });

    // Pairing Code logic
    if (config.whatsapp.authType === 'pairing' && !sock.authState.creds.me) {
        setTimeout(async () => {
            try {
                const phoneNumber = config.whatsapp.phoneNumber.replace(/[^0-9]/g, '');
                if (!phoneNumber) {
                    logger.error('Phone number missing in .env for pairing!');
                    return;
                }
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n\n[PAIRING CODE]: ${code}\n\n`);
            } catch (err) {
                logger.error(`Failed to request pairing code: ${err.message}`);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode 
                : null;
            
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            const reason = lastDisconnect.error?.message || 'Unknown Reason';
            
            logger.error(`Connection lost: ${reason}. Reconnecting: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                // Exponential backoff to avoid spamming logs (5s, 10s, 20s, max 60s)
                const delay = Math.min(60000, (global.reconnectAttempts || 0) * 5000 + 5000);
                global.reconnectAttempts = (global.reconnectAttempts || 0) + 1;
                
                logger.info(`Retrying connection in ${delay/1000}s... (Attempt ${global.reconnectAttempts})`);
                setTimeout(startBot, delay);
            } else {
                logger.fatal('Logged out. Please delete session folder and restart.');
                process.exit(1);
            }
        } else if (connection === 'open') {
            logger.info('SUCCESS: Bot is now online and connected.');
            global.reconnectAttempts = 0; // Reset on success
            reminderService.init(sock);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (!msg.message || msg.key.fromMe) continue;

                const remoteJid = msg.key.remoteJid;
                
                // Ignore Channels
                if (remoteJid?.endsWith('@newsletter')) continue;

                const pushName = msg.pushName || 'User';
                const isGroup = remoteJid.endsWith('@g.us');
                
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
                const isImage = !!msg.message.imageMessage;
                const isVideo = !!msg.message.videoMessage;
                const isSticker = !!msg.message.stickerMessage;
                const documentMessage = msg.message.documentMessage;

                            logger.info({ event: 'INCOMING', from: pushName, chat: remoteJid, text: text.slice(0, 50) });
                
                            // --- TRACK STATISTICS ---
                            statsTracker.addActivity(remoteJid, 'user', text);
                
                            // --- INTERACTIVE RECAP FLOW ---
                            if (recapManager.isInRecap(remoteJid)) {
                                await sock.sendPresenceUpdate('composing', remoteJid);
                                const nextStepText = await recapManager.getNextStep(remoteJid, text);
                                if (nextStepText) {
                                    return await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(nextStepText) });
                                }
                            }
                
                            // Trigger Recap (Manual for test or auto check)
                            if (text.toLowerCase() === '.recap') {
                                const intro = await recapManager.initiateRecap(remoteJid, 'monthly');
                                if (intro) {
                                    return await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(intro) });
                                } else {
                                    return await sock.sendMessage(remoteJid, { text: "_Belum ada data yang cukup untuk membuat recap bulan lalu._" });
                                }
                            }
                
                            if (documentMessage) {                    await handleDocument(sock, msg, documentMessage);
                    continue;
                }

            if (text.startsWith('.sticker') || text.startsWith('.stiker')) {
                logger.info(`Manual sticker command from ${pushName} (${remoteJid})`);
                await handleStickerCommand(sock, msg);
                continue;
            }

            if (text.toLowerCase() === '.newchat') {
                contextManager.clearHistory(remoteJid);
                logger.info(`Context cleared for ${remoteJid} by ${pushName}`);
                return await sock.sendMessage(remoteJid, { text: "_Konteks percakapan telah dihapus. Mari mulai obrolan baru!_" });
            }

            if (!text && !isImage && !isVideo && !isSticker) continue;

                // --- CONTEXT PREPARATION ---
                let finalUserText = text;
                if (pendingDocumentContexts.has(remoteJid)) {
                    const docContext = pendingDocumentContexts.get(remoteJid);
                    finalUserText = `Ini adalah isi dokumen yang saya miliki:\n'${docContext}'\n${text || "Apa isi dokumen ini?"}`;
                    pendingDocumentContexts.delete(remoteJid);
                }

                if (isSticker) {
                    finalUserText = `[Sticker Received] ${text || "React to this sticker visually."}`;
                }

                let mediaParts = [];
                let currentMediaPath = null;
                let currentMimeType = null;

                if (isImage || isVideo || isSticker) {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
                    const mimeType = isImage ? 'image/jpeg' : (isVideo ? 'video/mp4' : 'image/webp');
                    mediaParts.push({ inlineData: { data: buffer.toString('base64'), mimeType } });
                    
                    currentMimeType = mimeType;
                    currentMediaPath = path.join(TEMP_DIR, `in_${Date.now()}.${mimeType.split('/')[1]}`);
                    fs.writeFileSync(currentMediaPath, buffer);
                }

                contextManager.addMessage(remoteJid, finalUserText, 'user');
                await sock.sendPresenceUpdate('composing', remoteJid);

                // --- AI CORE LOGIC ---
                try {
                    let textResponse = await processWithGemini(sock, msg, remoteJid, text, mediaParts, currentMediaPath, currentMimeType);
                    
                    if (textResponse) {
                        contextManager.addMessage(remoteJid, textResponse, 'model');
                        await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(textResponse) });
                    }

                } catch (geminiError) {
                    logger.warn(`Gemini Error: ${geminiError.message}. Attempting Groq Fallback...`);
                    
                    try {
                        let fallbackResponse = await processWithGroq(sock, msg, remoteJid, finalUserText);
                        if (fallbackResponse) {
                            contextManager.addMessage(remoteJid, fallbackResponse, 'model');
                            await sock.sendMessage(remoteJid, { text: parseMarkdownToWhatsApp(fallbackResponse) });
                        }
                    } catch (groqError) {
                        logger.error(`Critical AI Failure: ${groqError.message}`);
                        await sock.sendMessage(remoteJid, { text: '_Maaf, sistem AI sedang tidak responsif. Mohon coba lagi nanti._' });
                    }
                } finally {
                    if (currentMediaPath && fs.existsSync(currentMediaPath)) fs.unlinkSync(currentMediaPath);
                }

            } catch (loopError) {
                logger.error(`Message Processing Error: ${loopError.message}`);
            }
        }
    });
}

// --- AI HANDLERS ---

async function processWithGemini(sock, msg, remoteJid, text, mediaParts, currentMediaPath, currentMimeType) {
    const history = contextManager.getHistory(remoteJid);
    const chatHistory = history.length > 0 ? history.slice(0, -1) : [];
    
    const chat = model.startChat({
        history: chatHistory,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
    });

    const messageParts = [];
    if (text) messageParts.push(text);
    messageParts.push(...mediaParts);

    let result = await chat.sendMessage(messageParts.length > 0 ? messageParts : "Analyze this.");
    let response = await result.response;
    let textResponse = response.text();
    let functionCalls = response.functionCalls();
    
    let loopCount = 0;
    while (functionCalls && functionCalls.length > 0 && loopCount < 5) {
        loopCount++;
        const functionResponses = [];

        for (const call of functionCalls) {
            const { name, args } = call;
            
            if (name === 'webSearch') await sock.sendMessage(remoteJid, { text: `> _Mencari di Google..._` });
            if (name === 'stickerMaker') await sock.sendMessage(remoteJid, { text: `> _Membuat stiker..._` });
            if (name === 'imageGenerator') await sock.sendMessage(remoteJid, { text: `> _Membuat gambar..._` });
            if (['fileGenerator', 'fileConverter'].includes(name)) await sock.sendMessage(remoteJid, { text: `> _Membuat file..._` });

            let toolContext = { remoteJid, filePath: currentMediaPath, mimeType: currentMimeType };
            if (!toolContext.filePath && ['stickerMaker', 'fileConverter', 'imageGenerator'].includes(name)) {
                const media = await downloadMediaForTool(sock, msg);
                if (media) {
                    toolContext.filePath = media.filePath;
                    toolContext.mimeType = media.mimeType;
                }
            }

            const toolResult = await toolHandler.executeTool(name, args, toolContext);
            
            // Handle Side Effects
            if (name === 'imageGenerator' && toolResult.success) {
                await sock.sendMessage(remoteJid, { image: { url: toolResult.imageUrl }, caption: `_Generated via Gemini_` });
            } else if (['fileGenerator', 'fileConverter'].includes(name) && toolResult.success) {
                const fileName = path.basename(toolResult.filePath);
                await sock.sendMessage(remoteJid, { 
                    document: { url: toolResult.filePath }, 
                    mimetype: mime.lookup(fileName) || 'application/octet-stream',
                    fileName: fileName
                });
            } else if (name === 'stickerMaker' && toolResult.success) {
                await sock.sendMessage(remoteJid, { sticker: { url: toolResult.stickerPath } });
            }

            functionResponses.push({ functionResponse: { name, response: { content: toolResult } } });
            if (toolContext.filePath && fs.existsSync(toolContext.filePath)) fs.unlinkSync(toolContext.filePath);
        }

        result = await chat.sendMessage(functionResponses);
        response = await result.response;
        textResponse = response.text();
        functionCalls = response.functionCalls();
    }
    return textResponse;
}

async function processWithGroq(sock, msg, remoteJid, text) {
    const history = contextManager.getHistory(remoteJid);
    const groqMessages = [{ role: "system", content: "Anda adalah asisten WhatsApp cerdas dengan akses ke berbagai tools. Jawab dalam Bahasa Indonesia." }];

    for (const m of history) {
        groqMessages.push({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.parts[0].text
        });
    }

    const tools = toolHandler.getOpenAITools();
    let loopCount = 0;

    while (loopCount < 5) {
        loopCount++;
        const completion = await groq.chat.completions.create({
            messages: groqMessages,
            model: config.ai.groq.powerfulModel || "llama-3.3-70b-versatile",
            tools: tools,
            tool_choice: "auto"
        });

        const responseMessage = completion.choices[0].message;
        groqMessages.push(responseMessage);

        if (responseMessage.tool_calls) {
            for (const toolCall of responseMessage.tool_calls) {
                const { name, arguments: argStr } = toolCall.function;
                const args = JSON.parse(argStr);
                
                if (name === 'webSearch') await sock.sendMessage(remoteJid, { text: `> _Mencari di Google..._` });
                if (name === 'stickerMaker') await sock.sendMessage(remoteJid, { text: `> _Membuat stiker..._` });
                if (name === 'imageGenerator') await sock.sendMessage(remoteJid, { text: `> _Membuat gambar..._` });
                if (['fileGenerator', 'fileConverter'].includes(name)) await sock.sendMessage(remoteJid, { text: `> _Membuat file..._` });

                let toolContext = { remoteJid };
                if (['stickerMaker', 'fileConverter', 'imageGenerator'].includes(name)) {
                    const media = await downloadMediaForTool(sock, msg);
                    if (media) {
                        toolContext.filePath = media.filePath;
                        toolContext.mimeType = media.mimeType;
                    }
                }

                const toolResult = await toolHandler.executeTool(name, args, toolContext);
                
                if (name === 'imageGenerator' && toolResult.success) {
                    await sock.sendMessage(remoteJid, { image: { url: toolResult.imageUrl }, caption: `_Generated via Groq_` });
                } else if (['fileGenerator', 'fileConverter'].includes(name) && toolResult.success) {
                    const fileName = path.basename(toolResult.filePath);
                    await sock.sendMessage(remoteJid, { 
                        document: { url: toolResult.filePath }, 
                        mimetype: mime.lookup(fileName) || 'application/octet-stream',
                        fileName: fileName
                    });
                } else if (name === 'stickerMaker' && toolResult.success) {
                    await sock.sendMessage(remoteJid, { sticker: { url: toolResult.stickerPath } });
                }

                groqMessages.push({ tool_call_id: toolCall.id, role: "tool", name, content: JSON.stringify(toolResult) });
                if (toolContext.filePath && fs.existsSync(toolContext.filePath)) fs.unlinkSync(toolContext.filePath);
            }
        } else {
            return responseMessage.content;
        }
    }
    return "Gagal memproses permintaan.";
}

// --- UTILITIES ---

async function downloadMediaForTool(sock, msg) {
    const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const message = quoted || msg.message;
    const mediaMsg = message.imageMessage || message.videoMessage || message.documentMessage || message.audioMessage || message.stickerMessage;
    if (!mediaMsg) return null;

    const buffer = await downloadMediaMessage({ message: message }, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
    const ext = mediaMsg.mimetype?.split('/')[1]?.split(';')[0] || 'bin';
    const tempPath = path.join(TEMP_DIR, `tool_${Date.now()}.${ext}`);
    fs.writeFileSync(tempPath, buffer);
    return { filePath: tempPath, mimeType: mediaMsg.mimetype };
}

async function handleStickerCommand(sock, msg) {

    const remoteJid = msg.key.remoteJid;

    await sock.sendMessage(remoteJid, { text: '> _Membuat stiker..._' });

    const media = await downloadMediaForTool(sock, msg);
    if (!media) return sock.sendMessage(remoteJid, { text: '_Kirim/balas media dengan .sticker_'});

    const result = await toolHandler.executeTool('stickerMaker', { target: 'auto' }, media);
    if (result.success) await sock.sendMessage(remoteJid, { sticker: { url: result.stickerPath } });
    if (fs.existsSync(media.filePath)) fs.unlinkSync(media.filePath);
}

async function handleDocument(sock, msg, docMsg) {
    const remoteJid = msg.key.remoteJid;
    const fileName = docMsg.fileName;
    const tempPath = path.join(TEMP_DIR, fileName);
    
    await sock.sendMessage(remoteJid, { text: '> _Membaca dokumen..._'});
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
        fs.writeFileSync(tempPath, buffer);
        const text = await ragHandler.extractText(tempPath, docMsg.mimetype);
        if (text?.trim().length > 0) {
            const analysis = await groqHandler.analyzeDocument(text, "Buat rangkuman detail.");
            pendingDocumentContexts.set(remoteJid, analysis);
            await sock.sendMessage(remoteJid, { text: `> _Dokumen "${fileName}" selesai dibaca. Dokumennya mau di apain?_` });
        }
        fs.unlinkSync(tempPath);
    } catch (err) {
        logger.error(`RAG Error: ${err.message}`);
    }
}

// --- START ---
logger.info('Waiting 10s for network initialization...');
setTimeout(async () => {
    await testDNS();
    startBot().catch(err => logger.fatal(`Startup Crash: ${err.message}`));
}, 10000);
