const schedule = require('node-schedule');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');

const logger = pino({
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
    }
});

const REMINDERS_FILE = path.join(__dirname, '../session/reminders.json');

class ReminderService {
    constructor() {
        this.jobs = new Map(); // id -> job
        this.sock = null;
    }

    init(sock) {
        this.sock = sock;
        
        // Ensure file exists to prevent watch error
        if (!fs.existsSync(REMINDERS_FILE)) {
            fs.writeJSONSync(REMINDERS_FILE, [], { spaces: 2 });
        }

        this.loadAndScheduleAll();
        
        // Use watchFile for better cross-platform stability in production
        fs.watchFile(REMINDERS_FILE, { interval: 5000 }, (curr, prev) => {
            if (curr.mtime !== prev.mtime) {
                logger.info('Reminders file changed, reloading...');
                this.loadAndScheduleAll();
            }
        });
    }

    loadAndScheduleAll() {
        try {
            if (!fs.existsSync(REMINDERS_FILE)) return;
            const reminders = fs.readJSONSync(REMINDERS_FILE);
            
            reminders.forEach(r => {
                if (r.status === 'pending' && !this.jobs.has(r.id)) {
                    const scheduledDate = new Date(r.time);
                    const now = new Date();

                    if (scheduledDate > now) {
                        this.scheduleJob(r);
                    } else {
                        // Mark missed reminders as done or notify immediately
                        logger.warn(`Missed reminder found for [${r.id}] scheduled at ${r.time}. Marking as done.`);
                        this.markAsDone(r.id);
                    }
                }
            });
        } catch (e) {
            logger.error(`Error loading reminders: ${e.message}`);
        }
    }

    scheduleJob(reminder) {
        // Prevent duplicate jobs
        if (this.jobs.has(reminder.id)) return;

        const job = schedule.scheduleJob(new Date(reminder.time), async () => {
            try {
                if (this.sock) {
                    logger.info({ event: 'REMINDER_FIRED', to: reminder.jid, task: reminder.task });
                    await this.sock.sendMessage(reminder.jid, { 
                        text: `⏰ *REMINDER CERDAS*\n\nHalo! Saya diingatkan untuk memberitahu Anda:\n\n> "${reminder.task}" ` 
                    });
                    this.markAsDone(reminder.id);
                    this.jobs.delete(reminder.id);
                }
            } catch (err) {
                logger.error(`Failed to send reminder [${reminder.id}]: ${err.message}`);
            }
        });
        
        if (job) {
            this.jobs.set(reminder.id, job);
            logger.info(`Scheduled reminder [${reminder.id}] for ${reminder.time}`);
        }
    }

    markAsDone(id) {
        try {
            // Read fresh data to avoid overwriting changes from other processes
            const reminders = fs.readJSONSync(REMINDERS_FILE);
            const index = reminders.findIndex(r => r.id === id);
            if (index !== -1) {
                reminders[index].status = 'done';
                fs.writeJSONSync(REMINDERS_FILE, reminders, { spaces: 2 });
            }
        } catch (e) {
            logger.error(`Error marking reminder as done: ${e.message}`);
        }
    }
}

const reminderService = new ReminderService();
module.exports = reminderService;