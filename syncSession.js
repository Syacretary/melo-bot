const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Script ini mendeteksi jika ada data sesi di Environment Variable
 * dan mengembalikannya ke folder ./session sebelum bot dijalankan.
 */
async function syncSession() {
    const sessionB64 = process.env.SESSION_DATA;
    const sessionPath = path.join(__dirname, 'session');

    if (sessionB64 && sessionB64.length > 100) {
        console.log("Mendeteksi SESSION_DATA dari Secret... Mengekstrak...");
        
        try {
            const zipPath = path.join(__dirname, 'session.zip');
            fs.writeFileSync(zipPath, Buffer.from(sessionB64, 'base64'));
            
            // Ekstrak menggunakan unzip (tersedia di Linux HF)
            fs.ensureDirSync(sessionPath);
            execSync(`unzip -o ${zipPath} -d .`);
            fs.unlinkSync(zipPath);
            
            console.log("Sesi berhasil dipulihkan!");
        } catch (error) {
            console.error("Gagal mengekstrak sesi:", error.message);
        }
    } else {
        console.log("Tidak ada SESSION_DATA ditemukan. Memulai sesi baru.");
    }
}

syncSession();
