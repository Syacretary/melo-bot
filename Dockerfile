FROM node:20-bullseye

# Install dependencies sistem (FFmpeg & LibreOffice)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libreoffice \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json dan install dependencies
COPY package*.json ./
RUN npm install

# Copy seluruh kode bot
COPY . .

# Port yang dibuka oleh HF
EXPOSE 7860

# Jalankan bot
CMD ["npm", "start"]
