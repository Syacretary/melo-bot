const fs = require('fs-extra');
const path = require('path');

const REMINDERS_FILE = path.join(__dirname, '../session/reminders.json');

module.exports = {
    /**
     * @param {object} args - { task, scheduledTime, action }
     * @param {object} context - { remoteJid }
     */
    execute: async (args, context) => {
        const { task, scheduledTime, action } = args;
        const { remoteJid } = context;

        if (!remoteJid) return { error: "Context missing remoteJid" };

        try {
            fs.ensureFileSync(REMINDERS_FILE);
            let reminders = [];
            try {
                reminders = fs.readJSONSync(REMINDERS_FILE);
            } catch (e) { reminders = []; }

            if (action === 'add') {
                const newReminder = {
                    id: Date.now().toString(),
                    jid: remoteJid,
                    task,
                    time: scheduledTime,
                    status: 'pending'
                };
                reminders.push(newReminder);
                fs.writeJSONSync(REMINDERS_FILE, reminders, { spaces: 2 });
                
                // Note: The actual scheduling happens in the background service 
                // which should watch this file or be notified.
                return { success: true, message: `Reminder terdaftar untuk ${newReminder.time}: "${task}"` };
            } 
            
            if (action === 'list') {
                const userReminders = reminders.filter(r => r.jid === remoteJid && r.status === 'pending');
                return { success: true, reminders: userReminders };
            }

            return { error: "Action not supported yet." };

        } catch (error) {
            console.error("Reminder Tool Error:", error);
            return { error: error.message };
        }
    }
};
