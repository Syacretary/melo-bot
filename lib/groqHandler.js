const Groq = require('groq-sdk');
const config = require('../config');
const pino = require('pino');

const logger = pino({
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
    }
});

const groq = new Groq({
    apiKey: config.ai.groq.apiKey
});

class GroqHandler {
    async analyzeDocument(docText, query) {
        try {
            logger.info(`Groq Analysis Started: Text length ${docText.length}, Query: "${query}"`);
            
            const safeText = docText.slice(0, 25000); 
            
            const completion = await groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "Anda adalah asisten analisis dokumen yang cerdas. Tugas anda adalah membaca konteks teks yang diberikan dan menjawab pertanyaan pengguna berdasarkan teks tersebut. Jawablah dalam Bahasa Indonesia yang jelas dan ringkas. Jika diminta merangkum, buatlah rangkuman poin-poin."
                    },
                    {
                        role: "user",
                        content: `KONTEKS DOKUMEN:\n${safeText}\n\nPERTANYAAN USER:\n${query}`
                    }
                ],
                model: config.ai.groq.fastModel || "llama-3.1-8b-instant",
                temperature: 0.5,
                max_tokens: 4096,
            });

            const result = completion.choices[0]?.message?.content || "Gagal mendapatkan analisis dari Groq.";
            logger.info(`Groq Analysis Finished. Output length: ${result.length}`);
            
            return result;
        } catch (error) {
            logger.error(`Groq Error: ${error.message}`);
            return "Terjadi kesalahan saat model kedua mencoba membaca dokumen.";
        }
    }
}

const groqHandler = new GroqHandler();
module.exports = groqHandler;