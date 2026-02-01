const fs = require('fs-extra');
const path = require('path');

const STATS_FILE = path.join(__dirname, '../session/stats.json');

class StatsTracker {
    constructor() {
        fs.ensureFileSync(STATS_FILE);
        this.data = this.loadData();
    }

    loadData() {
        try {
            return fs.readJSONSync(STATS_FILE);
        } catch (e) {
            return {};
        }
    }

    saveData() {
        fs.writeJSONSync(STATS_FILE, this.data, { spaces: 2 });
    }

    /**
     * Mencatat setiap pesan masuk
     */
    addActivity(jid, role = 'user', text = '') {
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');

        if (!this.data[jid]) this.data[jid] = {};
        if (!this.data[jid][year]) this.data[jid][year] = {};
        if (!this.data[jid][year][month]) this.data[jid][year][month] = {
            total_messages: 0,
            days_active: [],
            hourly_activity: {},
            topics_summary: [] // Cuplikan singkat untuk bahan AI
        };

        const monthData = this.data[jid][year][month];
        monthData.total_messages++;

        if (!monthData.days_active.includes(day)) {
            monthData.days_active.push(day);
        }

        const hour = now.getHours().toString();
        monthData.hourly_activity[hour] = (monthData.hourly_activity[hour] || 0) + 1;

        // Simpan sedikit sampel teks (maks 10 sampel per bulan untuk privasi & efisiensi)
        if (role === 'user' && text.length > 10 && monthData.topics_summary.length < 30) {
            if (Math.random() > 0.7) { // Random sampling
                monthData.topics_summary.push(text.slice(0, 100));
            }
        }

        this.saveData();
    }

    getUserStats(jid, year, month) {
        return this.data[jid]?.[year]?.[month] || null;
    }

    getYearlyStats(jid, year) {
        return this.data[jid]?.[year] || null;
    }
}

const statsTracker = new StatsTracker();
module.exports = statsTracker;
