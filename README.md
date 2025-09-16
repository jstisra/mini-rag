# Mini RAG App (Local + Ollama)

[![Node](https://img.shields.io/badge/Node-22.x-339933?logo=node.js&logoColor=white)](#)
[![Express](https://img.shields.io/badge/Express-Backend-000000?logo=express&logoColor=white)](#)
[![Ollama](https://img.shields.io/badge/Ollama-llama3.2-1f2937)](#)
[![Embeddings](https://img.shields.io/badge/Embeddings-Xenova%20MiniLM-0ea5e9)](#)
[![License](https://img.shields.io/badge/License-MIT-14b8a6)](#)

A minimal Retrieval-Augmented Generation (RAG) demo:
- **Local multilingual embeddings** (Xenova)
- **Local LLM** via **Ollama (llama3.2)**
- Ingest text → retrieve with cosine → generate with citations
- **Persistence to disk** (`data/memory.json`)
- Simple web UI (dark, card style)

![Screenshot](public/screenshot.png)

## Run
```bash
npm install
npm start
# open http://localhost:3000

Features

Paste text or Import .txt → chunk → embed → store

Ask questions; shows Top chunks and Answer with [#[ref]] citations

Export memory (JSON), Clear memory

Ping button to verify server is alive


## Project structure

├─ public/ # Static UI (index.html, style.css, favicon)
├─ src/
│ ├─ embeddings.js # Local multilingual embeddings (Xenova MiniLM) – singleton, mean-pool
│ ├─ retrieval.js # Chunking + cosine similarity + top-K retrieval
│ ├─ store.js # In-memory store + JSON persistence (data/memory.json)
│ └─ app.js # Express routes (ingest, ask, list, clear, export, ping)
├─ server.js # Entry point: builds app + starts server
├─ data/ # Persisted memory (ignored in git, keep .gitkeep)
└─ uploads/ # File uploads (currently unused, ignored in git)

### How it works
1. **Ingest**: splits input into overlapping chunks → local **embeddings** via Xenova → stored with vectors.
2. **Ask**: embeds the query → **cosine similarity** over stored vectors → returns top-K chunks → optional LLM (Ollama/OpenAI) formats an answer with citations.
3. **Persistence**: chunks saved to `data/memory.json`. Export/Import supported.

### Roadmap
- PDF ingestion (pdf.js server-side)
- Dockerfile (one-command run)
- One-click deployment (Render/Fly/Zeet)
- Optional: switchable embedding backends (OpenAI/Cloudflare)