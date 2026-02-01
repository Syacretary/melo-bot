const config = require('../config');
const axios = require('axios');
// Lazy load puppeteer to save RAM on startup
// const puppeteer = require('puppeteer-extra'); 

async function searchWithApi(query) {
    if (!config.search.apiKey || !config.search.cseId) return null;
    
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${config.search.apiKey}&cx=${config.search.cseId}&q=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        const items = response.data.items || [];
        return items.map(item => `Title: ${item.title}\nLink: ${item.link}\nSnippet: ${item.snippet}`).join('\n\n');
    } catch (error) {
        console.error('API Search Error:', error.message);
        return null;
    }
}

async function searchWithPuppeteer(query) {
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        
        // Wait for results
        await page.waitForSelector('#search');
        
        const results = await page.evaluate(() => {
            const items = document.querySelectorAll('.tF2Cxc'); // Common selector for Google results
            let data = [];
            items.forEach(item => {
                const title = item.querySelector('h3')?.innerText;
                const link = item.querySelector('a')?.href;
                const snippet = item.querySelector('.VwiC3b')?.innerText;
                if (title && link) {
                    data.push(`Title: ${title}\nLink: ${link}\nSnippet: ${snippet || ''}`);
                }
            });
            return data.slice(0, 5).join('\n\n');
        });
        
        return results;
    } catch (error) {
        console.error('Puppeteer Search Error:', error.message);
        return 'Failed to perform search.';
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = {
    execute: async ({ query }) => {
        let results = await searchWithApi(query);
        if (!results) {
            console.log('Falling back to Puppeteer search...');
            results = await searchWithPuppeteer(query);
        }
        return { result: results || 'No results found.' };
    }
};
