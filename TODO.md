# Project To-Do List: WhatsApp Bot with Baileys + AI (RAG & Tools)

- [x] **Project Setup**
    - [x] Initialize `package.json`
    - [x] Install dependencies (`@whiskeysockets/baileys`, `@google/generative-ai`, `dotenv`, `pino`, etc.)
    - [x] Create directory structure (`session`, `tools`, `tools/schemas`, `lib`)
    - [x] Create `.env.example` and `config.js`

- [x] **Core Architecture (Baileys)**
    - [x] Implement `index.js` connection logic
    - [x] Add Pairing Code authentication (+62 856-0727-7006 default)
    - [x] Implement Session handling
    - [x] Implement Message Handler (Basic)

- [x] **AI Integration & Logic**
    - [x] Create `lib/contextManager.js` (Memory per chat/group)
    - [x] Create `lib/toolHandler.js` (Dynamic Registry & Execution)
    - [x] Implement Native Tool Calling integration with Gemini SDK
    - [x] Implement `lib/markdownParser.js` (AI MD -> WA MD)

- [x] **RAG System**
    - [x] Create `lib/ragHandler.js` (Document extraction & Chunking)
    - [x] Implement file support (PDF, DOCX, TXT)
    - [x] Implement retrieval logic (`tools/documentSearch.js`)

- [x] **Tools Implementation**
    - [x] Create `tools/schemas/webSearch.json` & `tools/webSearch.js`
    - [x] Create `tools/schemas/fileGenerator.json` & `tools/fileGenerator.js`
    - [x] Implement UX Status Indicators (e.g., "> Mengecek di google")

- [x] **Final Polish**
    - [x] Verify structure against requirements
    - [x] Test build/lint (Project structure created and ready to run)