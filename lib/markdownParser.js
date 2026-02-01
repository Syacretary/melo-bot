/**
 * Parses Markdown from AI response to WhatsApp compatible format.
 * WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```monospace```
 */

function parseMarkdownToWhatsApp(text) {
    if (!text) return '';

    let formattedText = text;

    // Bold: **text** or __text__ -> *text*
    formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '*$1*');
    formattedText = formattedText.replace(/__(.*?)__/g, '*$1*');

    // Italic: *text* (if not matched by bold) or _text_ -> _text_
    // Note: This is tricky because * is also used for lists. 
    // We try to match pairs of * that are not part of a list or bold.
    // A simple approximation:
    formattedText = formattedText.replace(/(?<!\*)\*(?![*\s])(.*?)(?<!\s)\*(?!\*)/g, '_$1_');

    // Headers: # Header -> *Header*
    formattedText = formattedText.replace(/^#{1,6}\s+(.*)$/gm, '*$1*');

    // Strikethrough: ~~text~~ -> ~text~
    formattedText = formattedText.replace(/~~(.*?)~~/g, '~$1~');

    // Links: [text](url) -> text (url)
    formattedText = formattedText.replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)');

    // Lists: - item or * item -> • item (WhatsApp renders bullet points better with •)
    // formattedText = formattedText.replace(/^[\*\-]\s+(.*)$/gm, '• $1');

    return formattedText;
}

module.exports = { parseMarkdownToWhatsApp };
