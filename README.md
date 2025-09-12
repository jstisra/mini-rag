# Mini RAG App (Local + Ollama)

A minimal Retrieval-Augmented Generation (RAG) demo built with:

- **Express.js** backend
- **@xenova/transformers** for local multilingual embeddings (free, offline)
- **Ollama** (`llama3.2`) for local LLM generation
- Simple browser UI (HTML/JS) for ingesting text and asking questions

## Features
- Ingest text → split into chunks → embed and store vectors in memory/disk
- Query with semantic search (cosine similarity)
- Generate concise answers with citations using Ollama
- Persistence: ingested data survives server restarts (`data/memory.json`)

## Run locally
```bash
npm install
node index.js
