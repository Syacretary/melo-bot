const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs-extra');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

module.exports = {
    /**
     * @param {object} args
     * @param {object} context - Contains filePath and mimeType of the media
     */
    execute: async (args, context) => {
        const { filePath, mimeType } = context;
        if (!filePath) return { error: 'No media found to convert.' };

        const outputName = `sticker_${Date.now()}.webp`;
        const outputPath = path.join(__dirname, '../temp_files', outputName);
        fs.ensureDirSync(path.join(__dirname, '../temp_files'));

        return new Promise((resolve, reject) => {
            let command = ffmpeg(filePath);

            if (mimeType.includes('video')) {
                // Video to Animated Sticker (max 6 seconds)
                command
                    .setStartTime(0)
                    .setDuration(6)
                    .on('error', (err) => resolve({ error: `FFMPEG Error: ${err.message}` }))
                    .on('end', () => resolve({ success: true, stickerPath: outputPath }))
                    .addOutputOptions([
                        '-vcodec', 'libwebp',
                        '-vf', 'scale=512:512:force_original_aspect_ratio=increase,fps=15,crop=512:512',
                        '-loop', '0',
                        '-preset', 'default',
                        '-an',
                        '-vsync', '0',
                        '-s', '512:512'
                    ])
                    .toFormat('webp')
                    .save(outputPath);
            } else {
                // Image to Static Sticker
                command
                    .on('error', (err) => resolve({ error: `FFMPEG Error: ${err.message}` }))
                    .on('end', () => resolve({ success: true, stickerPath: outputPath }))
                    .addOutputOptions([
                        '-vcodec', 'libwebp',
                        '-vf', 'scale=512:512:force_original_aspect_ratio=increase,fps=15,crop=512:512'
                    ])
                    .toFormat('webp')
                    .save(outputPath);
            }
        });
    }
};
