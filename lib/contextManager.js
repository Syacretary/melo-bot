const fs = require('fs-extra');
const path = require('path');

class ContextManager {
    constructor(limit = 10) { // Kurangi limit dari 20 ke 10 untuk hemat kuota
        this.history = new Map(); 
        this.limit = limit;
        this.maxCharPerMessage = 1000; // Batas karakter per pesan di riwayat
    }

    /**
     * Get chat history for a specific JID
     */
    getHistory(jid) {
        if (!this.history.has(jid)) {
            this.history.set(jid, []);
        }
        return this.history.get(jid);
    }

    /**
     * Add a message to the history
     */
    addMessage(jid, text, role = 'user') {
        const history = this.getHistory(jid);
        
        let finalRole = role;
        let finalText = text;

        // Truncate jika teks terlalu panjang di history (Hemat Token)
        if (finalText.length > this.maxCharPerMessage) {
            finalText = finalText.slice(0, this.maxCharPerMessage) + "... (teks dipotong untuk hemat kuota)";
        }

        if (role === 'ai') {
            finalRole = 'model';
        } else if (role === 'system') {
            finalRole = 'user';
            finalText = `[System]: ${finalText}`;
        }
        
        const message = {
            role: finalRole,
            parts: [{ text: finalText }]
        };

        history.push(message);

        // Prune history
        if (history.length > this.limit) {
            history.shift();
        }
    }

    /**
     * Clear history for a JID
     * @param {string} jid 
     */
    clearHistory(jid) {
        this.history.delete(jid);
    }

    /**
     * Get formatted history for Gemini API
     * @param {string} jid 
     */
    getFormattedHistory(jid) {
        return this.getHistory(jid);
    }
}

// Singleton instance
const contextManager = new ContextManager();
module.exports = contextManager;
