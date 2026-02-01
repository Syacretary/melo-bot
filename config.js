require('dotenv').config();

const config = {
    ai: {
        groq: {
            apiKey: process.env.GROQ_API_KEY,
            fastModel: process.env.GROQ_FAST_MODEL || 'llama-3.1-8b-instant',
            powerfulModel: process.env.GROQ_POWERFUL_MODEL || 'llama-3.3-70b-versatile'
        },
        openRouter: {
            apiKey: process.env.OPENROUTER_API_KEY,
            model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free'
        },
        google: {
            apiKey: process.env.GOOGLE_AI_API_KEY,
            model: process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash'
        },
        huggingFace: {
            apiKey: process.env.HUGGINGFACE_API_KEY,
            model: process.env.HUGGINGFACE_MODEL || 'google/gemma-3-27b-it'
        }
    },
    search: {
        apiKey: process.env.GOOGLE_SEARCH_API_KEY,
        cseId: process.env.GOOGLE_CSE_ID
    },
    cloudConvertApiKey: process.env.CLOUDCONVERT_API_KEY,
    whatsapp: {
        phoneNumber: process.env.PHONE_NUMBER || process.env.DEFAULT_NUMBER || '6285607277006',
        sessionPath: './session',
        authType: 'pairing' // 'qr' or 'pairing'
    }
};

module.exports = config;
