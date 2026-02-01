const fs = require('fs-extra');
const path = require('path');

class ContextManager {
    constructor(limit = 20) {
        this.history = new Map(); // Key: remoteJid, Value: Array of messages
        this.limit = limit;
    }

    /**
     * Get chat history for a specific JID
     * @param {string} jid - The Chat ID (user or group)
     * @returns {Array} - Array of message objects { role, parts: [{ text }] }
     */
    getHistory(jid) {
        if (!this.history.has(jid)) {
            this.history.set(jid, []);
        }
        return this.history.get(jid);
    }

    /**
     * Add a message to the history
     * @param {string} jid 
     * @param {string} text 
     * @param {string} role - 'user' | 'model' | 'system'
     */
    addMessage(jid, text, role = 'user') {
        const history = this.getHistory(jid);
        
        let finalRole = role;
        let finalText = text;

        // Gemini only accepts 'user' and 'model'. Handle 'system' or 'ai'.
        if (role === 'ai') {
            finalRole = 'model';
        } else if (role === 'system') {
            finalRole = 'user';
            finalText = `[System Notice]: ${text}`;
        }
        
        const message = {
            role: finalRole,
            parts: [{ text: finalText }]
        };

        history.push(message);

        // Prune if exceeds limit (keep system prompt if we had one, but we are using native tools so maybe less reliance on system prompt in history)
        if (history.length > this.limit) {
            // Remove the oldest message (index 0)
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
