const fs = require('fs-extra');
const path = require('path');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const TEMP_DIR = path.join(__dirname, '../temp_files');
fs.ensureDirSync(TEMP_DIR);

module.exports = {
    execute: async ({ filename, content, format }) => {
        const filePath = path.join(TEMP_DIR, filename);
        
        try {
            if (format === 'pdf' || filename.endsWith('.pdf')) {
                const doc = new PDFDocument();
                const stream = fs.createWriteStream(filePath);
                doc.pipe(stream);
                doc.fontSize(12).text(content, 100, 100);
                doc.end();
                
                await new Promise((resolve) => stream.on('finish', resolve));
            } else if (format === 'docx' || filename.endsWith('.docx')) {
                const doc = new Document({
                    sections: [{
                        properties: {},
                        children: content.split('\n').map(line => 
                            new Paragraph({
                                children: [new TextRun(line)],
                            })
                        ),
                    }],
                });
                
                const buffer = await Packer.toBuffer(doc);
                fs.writeFileSync(filePath, buffer);
            } else {
                // txt, code (py, js, html)
                fs.writeFileSync(filePath, content);
            }

            return { 
                success: true, 
                filePath: filePath, 
                message: `File ${filename} created successfully.` 
            };
        } catch (error) {
            console.error('File Generation Error:', error);
            return { error: 'Failed to generate file.' };
        }
    }
};
