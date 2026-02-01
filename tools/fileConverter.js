const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const sharp = require('sharp');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

module.exports = {
    /**
     * Konverter File Lokal yang Kuat (FFmpeg + Sharp + LibreOffice)
     */
    execute: async (args, context) => {
        const { outputFormat } = args;
        const { filePath, mimeType } = context;

        if (!outputFormat) return { error: 'Format output tidak ditentukan.' };
        if (!filePath || !fs.existsSync(filePath)) return { error: 'File sumber tidak ditemukan.' };

        const inputExt = path.extname(filePath).toLowerCase().replace('.', '');
        const targetFormat = outputFormat.toLowerCase().replace('.', '');
        const outputFileName = `${path.parse(filePath).name}_converted.${targetFormat}`;
        const outputPath = path.join(__dirname, '../temp_files', outputFileName);
        
        fs.ensureDirSync(path.join(__dirname, '../temp_files'));

        try {
            // --- KATEGORI 1: GAMBAR (PNG, JPG, WEBP, TIFF, dll) ---
            if (mimeType.startsWith('image/') && !mimeType.includes('photoshop')) {
                await sharp(filePath)
                    .toFormat(targetFormat)
                    .toFile(outputPath);
                return { success: true, filePath: outputPath };
            }

            // --- KATEGORI 2: AUDIO & VIDEO (MP4, MP3, MKV, WAV, dll) ---
            if (mimeType.startsWith('video/') || mimeType.startsWith('audio/') || ['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'flac', 'opus'].includes(inputExt)) {
                return new Promise((resolve) => {
                    let command = ffmpeg(filePath).toFormat(targetFormat);
                    
                    if (targetFormat === 'mp3') {
                        command.audioBitrate('192k').noVideo();
                    }

                    command
                        .on('end', () => resolve({ success: true, filePath: outputPath }))
                        .on('error', (err) => resolve({ error: `FFmpeg Error: ${err.message}` }))
                        .save(outputPath);
                });
            }

            // --- KATEGORI 3: DOKUMEN (DOCX, PDF, XLSX, PPTX) ---
            // Menggunakan LibreOffice Headless (Harus terinstall di OS)
            const docFormats = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'rtf', 'html'];
            if (docFormats.includes(inputExt) || docFormats.includes(targetFormat)) {
                return new Promise((resolve) => {
                    // LibreOffice command: libreoffice --headless --convert-to [format] [file] --outdir [dir]
                    const cmd = `libreoffice --headless --convert-to ${targetFormat} "${filePath}" --outdir "${path.join(__dirname, '../temp_files')}"`;
                    
                    exec(cmd, (error, stdout, stderr) => {
                        if (error) {
                            return resolve({ error: `LibreOffice Error: ${error.message}. Pastikan LibreOffice terinstall di server.` });
                        }
                        
                        // LibreOffice terkadang menggunakan nama file asli, kita perlu mendeteksinya
                        const expectedPath = path.join(__dirname, '../temp_files', `${path.parse(filePath).name}.${targetFormat}`);
                        if (fs.existsSync(expectedPath)) {
                            // Rename agar sesuai dengan outputFileName kita (opsional)
                            fs.renameSync(expectedPath, outputPath);
                            resolve({ success: true, filePath: outputPath });
                        } else {
                            resolve({ error: "Gagal menemukan file hasil konversi LibreOffice." });
                        }
                    });
                });
            }

            return { error: `Format konversi dari ${inputExt} ke ${targetFormat} belum didukung oleh engine lokal.` };

        } catch (error) {
            console.error('Local Conversion Error:', error);
            return { error: `Konversi gagal: ${error.message}` };
        }
    }
};