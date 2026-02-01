const groqHandler = require('./groqHandler');
const statsTracker = require('./statsTracker');

class RecapManager {
    constructor() {
        this.activeRecaps = new Map(); // jid -> { type, step, data }
    }

    /**
     * Memulai proses recap
     */
    async initiateRecap(jid, type = 'monthly') {
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const year = lastMonth.getFullYear().toString();
        const month = (lastMonth.getMonth() + 1).toString().padStart(2, '0');
        
        const stats = statsTracker.getUserStats(jid, year, month);
        if (!stats || stats.total_messages < 5) return null;

        const monthName = lastMonth.toLocaleString('id-ID', { month: 'long' });
        
        // State awal
        this.activeRecaps.set(jid, {
            type,
            step: 0,
            monthName,
            stats,
            history: [] // Untuk menjaga konsistensi narasi AI
        });

        return this.getNextStep(jid);
    }

    async getNextStep(jid, userReply = '') {
        const session = this.activeRecaps.get(jid);
        if (!session) return null;

        session.step++;
        
        const { stats, monthName, step, type } = session;
        
        // Prompt dasar untuk AI agar gaya bicaranya "Deep & Trendy"
        const systemPrompt = `Anda adalah asisten yang sedang memberikan kilas balik (recap) ${type} kepada user. 
        Gunakan gaya bahasa anak muda zaman sekarang yang puitis tapi santai, gunakan plesetan atau tren terkait bulan ${monthName}. 
        Urutan ini harus terasa personal (psychologically moving). 
        Jangan berikan semua info sekaligus. HANYA berikan bagian untuk STEP ${step}.
        Gunakan Bahasa Indonesia yang sangat akrab.`;

        let prompt = "";
        
        if (type === 'monthly') {
            switch(step) {
                case 1: // Hook & Intro
                    prompt = "Berikan kalimat pembuka yang sangat menarik tentang perjalanan kita di bulan ${monthName}. Mention bahwa kita sudah melewati banyak hal bersama.";
                    break;
                case 2: // Stats Dasar
                    prompt = "Berikan data: Kita ngobrol selama ${stats.days_active.length} hari dengan total ${stats.total_messages} pesan. Berikan komentar unik tentang angka ini.";
                    break;
                case 3: // Puncak & Kebiasaan
                    const peakHour = Object.entries(stats.hourly_activity).sort((a,b) => b[1]-a[1])[0][0];
                    prompt = `Bahas tentang puncak aktivitas kita yang biasanya jam ${peakHour}.00. Juga bahas pola/kebiasaan baru yang kamu tangkap dari topik ini: ${stats.topics_summary.join(", ")}. Tanya pendapat user tentang kebiasaan ini untuk mengakhiri recap.`;
                    break;
                default:
                    this.activeRecaps.delete(jid);
                    return null;
            }
        }

        const response = await groqHandler.analyzeDocument(JSON.stringify(stats), `${systemPrompt}\n\n${prompt}`);
        
        // Jika step terakhir, hapus sesi
        if (step >= 3) this.activeRecaps.delete(jid);
        
        return response;
    }

    isInRecap(jid) {
        return this.activeRecaps.has(jid);
    }
}

const recapManager = new RecapManager();
module.exports = recapManager;
