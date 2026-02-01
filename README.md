---
title: Melo
emoji: 🤖
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
---

# 🤖 WhatsApp AI Bot (Baileys + Gemini + RAG + Local Tools)

Bot WhatsApp canggih berbasis `Baileys` yang terintegrasi dengan berbagai provider AI (Multi-Modal) menggunakan sistem **Native Tool Calling** dan **RAG (Retrieval-Augmented Generation)**. Bot ini dirancang untuk performa tinggi, efisiensi token, dan kemampuan pengolahan file lokal yang kuat.

---

## 🚀 Fitur Utama

### 1. Multi-Modal AI & Fallback
*   **Engine Utama**: Gemini 2.5 Flash (Mendukung input Teks, Gambar, Video, dan Stiker).
*   **Engine Cadangan (Auto-Fallback)**: Jika Gemini mengalami error atau limit, bot otomatis beralih ke **Groq (Llama-3.3-70b)** untuk memastikan layanan tetap online.
*   **Konteks Cerdas**: AI mengingat riwayat percakapan secara terpisah antara Chat Pribadi dan Chat Grup.

### 2. Sistem RAG (Retrieval-Augmented Generation)
*   **Auto-Extraction**: Membaca otomatis file PDF, DOCX, TXT, dan PPTX yang dikirim user.
*   **Intelligent Analysis**: Menggunakan Groq (Llama-3) untuk merangkum dan memahami isi dokumen secara instan saat file diterima.
*   **Context Injection**: Hasil analisis dokumen disuntikkan langsung ke percakapan berikutnya agar AI memahami konteks file tanpa perlu memanggil tool manual.

### 3. Tools Modular (Native Function Calling)
*   **Web Search**: Mencari informasi terbaru secara real-time di Google.
*   **Sticker Maker**: Konversi Gambar & Video (6 detik) menjadi stiker secara lokal menggunakan FFmpeg. (Gunakan perintah `.sticker` atau minta AI).
*   **Universal File Converter**: Mengubah format file apapun secara lokal (PDF <-> Word, Image <-> PDF, Audio Extraction, dll) menggunakan **LibreOffice** & **Sharp**.
*   **Image Generator**: Membuat gambar inovatif melalui OpenRouter (Flux.2 & Seedream).
*   **Smart Reminder**: Penjadwalan pengingat otomatis yang tetap aktif meskipun bot restart.

### 4. Aktivitas & UX
*   **Status Indicator**: Menampilkan status seperti _"Mencari di Google..."_ atau _"Membuat stiker..."_ untuk feedback yang transparan.
*   **Sticker Reactive**: AI akan bereaksi secara interaktif terhadap visual stiker yang dikirim oleh user.
*   **Logging Detail**: Seluruh aktivitas pesan, penggunaan tool, dan error dicatat secara rinci di terminal menggunakan `pino-pretty`.

---

## 🛠️ Persyaratan Sistem

Bot ini menggunakan engine lokal untuk konversi file agar tidak bergantung pada API berbayar:
1.  **Node.js** v18 atau lebih tinggi.
2.  **FFmpeg**: Untuk pembuatan stiker dan konversi media.
3.  **LibreOffice**: Untuk konversi dokumen (PDF, Word, Excel).

**Install di Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg libreoffice -y
```

---

## ⚙️ Instalasi & Setup

1.  **Clone / Download Project**
2.  **Install Dependency:**
    ```bash
    npm install
    ```
3.  **Konfigurasi Environment:**
    Salin `.env.example` menjadi `.env` dan isi API Key Anda:
    ```env
    GOOGLE_AI_API_KEY=your_key
    GROQ_API_KEY=your_key
    OPENROUTER_API_KEY=your_key
    PHONE_NUMBER=6285607277006
    ```
4.  **Jalankan Bot:**
    ```bash
    npm start
    ```
5.  **Pairing:** Masukkan kode pairing yang muncul di terminal ke WhatsApp Anda (Linked Devices).

---

## 📂 Struktur Project

```text
├── index.js                # Entry point & Logika Orchestration
├── config.js               # Konfigurasi API & Environment
├── lib/
│   ├── contextManager.js   # Pengelola memori percakapan
│   ├── toolHandler.js      # Registry & Eksekutor Tool
│   ├── ragHandler.js       # Ekstraksi teks dokumen cerdas (OCR support)
│   ├── groqHandler.js      # Analisis dokumen cepat via Groq
│   ├── reminderService.js  # Layanan pengingat latar belakang
│   └── markdownParser.js   # Parser format pesan WhatsApp
├── tools/                  # Implementasi fungsi tools lokal
└── session/                # Penyimpanan sesi & data (reminders, doc_store)
```

---

## 🛡️ Keamanan & Privasi
*   **Offline Processing**: Konversi file dilakukan secara lokal di server Anda.
*   **Channel Blocking**: Bot tidak akan merespons pesan dari WhatsApp Channels/Newsletter untuk menjaga kuota AI.
*   **Auto-Cleanup**: File sementara otomatis dihapus setelah diproses untuk menjaga kerahasiaan data.

---
*Dibuat dengan ❤️ untuk sistem bot WhatsApp yang lebih cerdas dan responsif.*
# melo-bot
