const axios = require('axios');
const config = require('../config');
const fs = require('fs-extra');
const path = require('path');

const MODELS = [
    "black-forest-labs/flux.2-klein-4b",
    "bytedance-seed/seedream-4.5",
    "black-forest-labs/flux.2-max"
];

module.exports = {
    /**
     * @param {object} args - { prompt }
     * @param {object} context - { filePath, mimeType } for Image-to-Image
     */
    execute: async (args, context) => {
        const { prompt } = args;
        const { filePath, mimeType } = context;
        
        if (!config.ai.openRouter.apiKey) {
            return { error: "OpenRouter API Key is missing." };
        }

        // Prepare image data if exists (Image-to-Image / Reference)
        let imageData = null;
        if (filePath && fs.existsSync(filePath) && mimeType.startsWith('image/')) {
            imageData = fs.readFileSync(filePath).toString('base64');
        }

        for (const model of MODELS) {
            try {
                console.log(`Attempting image generation with model: ${model}...`);
                
                const payload = {
                    model: model,
                    prompt: prompt,
                };

                // Add reference image for multimodal models if available
                if (imageData) {
                    payload.images = [imageData];
                }

                const response = await axios.post('https://openrouter.ai/api/v1/images/generations', payload, {
                    headers: {
                        'Authorization': `Bearer ${config.ai.openRouter.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000 // Image gen can be slow
                });

                if (response.data && response.data.data && response.data.data[0]) {
                    const imageUrl = response.data.data[0].url;
                    return { 
                        success: true, 
                        imageUrl: imageUrl, 
                        modelUsed: model,
                        message: `Image generated using ${model}` 
                    };
                }
            } catch (error) {
                console.warn(`Model ${model} failed:`, error.response?.data || error.message);
                continue; // Try next model
            }
        }

        return { error: "All image generation models failed. Please try again later." };
    }
};
