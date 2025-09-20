# Mini RAG App (Cloudflare Workers)

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](#)
[![Hono](https://img.shields.io/badge/Router-Hono-111)](#)
[![D1](https://img.shields.io/badge/DB-D1%20(SQLite)-0ea5e9)](#)
[![Vectorize](https://img.shields.io/badge/Vector%20DB-Vectorize-8b5cf6)](#)
[![Workers AI](https://img.shields.io/badge/LLM-Workers%20AI-f97316)](#)
[![License](https://img.shields.io/badge/License-MIT-14b8a6)](#)

Minimal Retrieval-Augmented Generation app at the **edge**.  
Ingest → embed → store → retrieve → answer with citations.  
Static UI in `/public`.

> Local/Ollama version is in branch **`local-xenova`**.

## Stack 
- **Runtime / Router:** Cloudflare Workers + Hono  
- **Storage:** D1 (serverless SQLite) for chunks/metadata  
- **Vector search:** Vectorize  
- **Models:** Workers AI (embeddings + chat)  
- **Static assets:** served via `assets` in `wrangler.toml`

--

![Screenshot](public/screenshot.png)

---

## Run (Local Dev)

```bash
npm install
npx wrangler login
npm run dev
# open http://127.0.0.1:8787

## Features

Paste text or Import .txt → chunk → embed → store

Ask questions → top chunks + citation-style answers

Export / Clear memory

Cloudflare-native stack (no local Ollama needed)
--

## Project structure
Local-old-vers
├─ public/ # Static UI (index.html, style.css, favicon)
├─ src/
│ ├─ embeddings.js # Local multilingual embeddings (Xenova MiniLM) – singleton, mean-pool
│ ├─ retrieval.js # Chunking + cosine similarity + top-K retrieval
│ ├─ store.js # In-memory store + JSON persistence (data/memory.json)
│ └─ app.js # Express routes (ingest, ask, list, clear, export, ping)
├─ server.js # Entry point: builds app + starts server
├─ data/ # Persisted memory (ignored in git, keep .gitkeep)
└─ uploads/ # File uploads (currently unused, ignored in git)

cloud-new-ver
public/         # Static UI (index.html, style.css, screenshot.png)
src/
 ├─ app.js      # Hono routes (Worker entrypoint)
 ├─ embeddings.js  # Workers AI (embed + chat)
 ├─ retrieval.js   # Chunking + Vectorize retrieval
 └─ store.js       # D1 helpers (insert/get/delete)

wrangler.toml   # Bindings (AI, D1, Vectorize, assets)

### How it works OLD-vers
1. **Ingest**: splits input into overlapping chunks → local **embeddings** via Xenova → stored with vectors.
2. **Ask**: embeds the query → **cosine similarity** over stored vectors → returns top-K chunks → optional LLM (Ollama/OpenAI) formats an answer with citations.
3. **Persistence**: chunks saved to `data/memory.json`. Export/Import supported.

### How it works NEW-vers
1. **Ingest**: split text → embed via Workers AI → save in D1 + Vectorize.
2. **Ask**: query embedding → cosine similarity in Vectorize → fetch top-K from D1 → AI formats answer with citations.
3. **Persistence**: all chunks survive restarts (D1).

### Roadmap
- PDF ingestion (pdf.js server-side)

## Deploy to Cloudflare
# One-time: create database + vector index
npx wrangler d1 create mini_rag_db
npx wrangler vectorize create mini_rag_vectors --dimensions=768 --metric=cosine

# Run migrations (table for chunks)
npx wrangler d1 execute mini_rag_db --remote --command "CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, text TEXT NOT NULL, meta TEXT);"

# Deploy
npm run deploy
# → https://mini-rag-edge.<your-subdomain>.workers.dev


## Branches

cloudflare — this edge deployment (Workers AI + D1 + Vectorize)

local-xenova — local version with Express + Xenova embeddings + memory.json