const fs = require('fs-extra');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const officeParser = require('officeparser');
const XLSX = require('xlsx');
const Tesseract = require('tesseract.js');
const mime = require('mime-types');

class RagHandler {
    constructor() {
        this.storePath = path.join(__dirname, '../session/doc_store');
        fs.ensureDirSync(this.storePath);
    }

    /**
     * Membersihkan teks hasil ekstraksi dari whitespace berlebih dan karakter aneh.
     */
    cleanText(text) {
        if (!text) return "";
        return text
            .replace(/\r\n/g, '\n') // Normalize newlines
            .replace(/\t/g, ' ')    // Tabs to spaces
            .replace(/ +/g, ' ')    // Multiple spaces to single space
            .replace(/\n\s*\n/g, '\n\n') // Max 2 newlines
            .trim();
    }

    /**
     * Smart Extraction Router
     */
    async extractText(filePath, mimeType) {
        try {
            let extractedText = "";
            const ext = path.extname(filePath).toLowerCase();

            // 1. PDF Handling
            if (mimeType === 'application/pdf' || ext === '.pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const data = await pdf(dataBuffer);
                extractedText = data.text;
                
                // Jika PDF kosong (mungkin scanned), fallback ke OCR (Optional logic could go here, 
                // but pdf-parse is usually fast. OCR on PDF pages requires splitting which is heavy).
                if (extractedText.trim().length < 50) {
                    extractedText += "\n[Catatan Sistem: Teks sangat sedikit. Dokumen ini mungkin berisi gambar scan yang sulit dibaca secara langsung.]";
                }
            } 
            // 2. Word (DOCX)
            else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
                const result = await mammoth.extractRawText({ path: filePath });
                extractedText = result.value;
            } 
            // 3. Excel / CSV (XLSX, XLS, CSV)
            else if (
                mimeType.includes('spreadsheet') || 
                mimeType.includes('excel') || 
                ext === '.xlsx' || ext === '.xls' || ext === '.csv'
            ) {
                const workbook = XLSX.readFile(filePath);
                const sheetNames = workbook.SheetNames;
                let excelData = [];
                
                sheetNames.forEach(name => {
                    const sheet = workbook.Sheets[name];
                    const csv = XLSX.utils.sheet_to_csv(sheet);
                    if (csv && csv.trim().length > 0) {
                        excelData.push(`--- Sheet: ${name} ---
${csv}`);
                    }
                });
                extractedText = excelData.join('\n\n');
            }
            // 4. PowerPoint (PPTX, PPT)
            else if (mimeType.includes('presentation') || mimeType.includes('powerpoint') || ext === '.pptx' || ext === '.ppt') {
                extractedText = await new Promise((resolve, reject) => {
                    officeParser.parseOffice(filePath, (data, err) => {
                        if (err) resolve(""); // Fail gracefully
                        else resolve(data);
                    });
                });
            }
            // 5. Images (OCR)
            else if (mimeType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) {
                console.log(`Starting OCR for ${filePath}...`);
                const { data: { text } } = await Tesseract.recognize(filePath, 'ind', { // 'ind' for Indonesian
                    logger: m => {} // Silent logger
                });
                extractedText = text;
            }
            // 6. Plain Text / Code
            else {
                // Fallback for .txt, .js, .py, .json, etc.
                extractedText = fs.readFileSync(filePath, 'utf8');
            }

            return this.cleanText(extractedText);

        } catch (error) {
            console.error('Smart Extraction Error:', error);
            return `[Error: Gagal mengekstrak teks dari file ini. Format mungkin rusak atau tidak didukung.]`;
        }
    }

    async saveDocumentContext(jid, text) {
        const filePath = path.join(this.storePath, `${jid.replace(/\D/g, '')}.txt`);
        await fs.writeFile(filePath, text, 'utf8');
        return filePath;
    }

    async getDocumentContext(jid) {
        const filePath = path.join(this.storePath, `${jid.replace(/\D/g, '')}.txt`);
        if (fs.existsSync(filePath)) {
            return await fs.readFile(filePath, 'utf8');
        }
        return null;
    }
}

const ragHandler = new RagHandler();
module.exports = ragHandler;
