# Mini-RAG (Edge on Cloudflare)

[![Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](#)
[![Hono](https://img.shields.io/badge/Hono-Router-111?logo=hono)](#)
[![D1](https://img.shields.io/badge/DB-D1%20(SQLite)-0ea5e9)](#)
[![Vectorize](https://img.shields.io/badge/Vector%20DB-Vectorize-8b5cf6)](#)
[![Workers AI](https://img.shields.io/badge/LLM-Workers%20AI-f97316)](#)
[![License](https://img.shields.io/badge/License-MIT-14b8a6)](#)

A minimal **Retrieval-Augmented Generation** app deployed at the **edge**.  
Ingest text → embed → store → retrieve top-K → answer with **citations**.

- Runtime: **Cloudflare Workers** with **Hono**
- Storage: **D1** (SQLite serverless) for chunks/metadata
- Vector search: **Vectorize**
- Models: **Workers AI** for embeddings + chat
- Static UI served from `/public`

> Looking for the local/Ollama version? See branch `local-xenova`.

---

## Live

- API: `GET /ping`, `POST /ingest`, `GET /ask`, `DELETE /delete/:id`
- Frontend: served from `/` (files in `public/`)

Example:
GET /ping
POST /ingest { "text": "Stockholm is the capital of Sweden.", "meta": {"source":"demo"} }
GET /ask?q=What%20is%20the%20capital%20of%20Sweden%3F

yaml
Kopiera kod

---

## Quick start (dev)

Requirements:
- Node 18+ (just for tooling)
- Cloudflare account + **Wrangler** (CLI)

Install deps:
```bash
npm i
Login once:

bash
Kopiera kod
npx wrangler login
Set up resources (one-time):

bash
Kopiera kod
# D1 (copy database_id into wrangler.toml)
npx wrangler d1 create mini_rag_db

# Vectorize index
npx wrangler vectorize create mini_rag_vectors --dimensions=768 --metric=cosine

# Create table
npx wrangler d1 execute mini_rag_db --remote --command "CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, text TEXT NOT NULL, meta TEXT);"
Run locally (remote bindings enabled):

bash
Kopiera kod
npm run dev
# or: npx wrangler dev --remote
Deploy
bash
Kopiera kod
npm run deploy
# prints: https://mini-rag-edge.<your-subdomain>.workers.dev
API (JSON)
POST /ingest
Body:

json
Kopiera kod
{ "text": "Your paragraph of text", "meta": { "source": "demo" } }
Response:

json
Kopiera kod
{ "ok": true, "chunksAdded": 1 }
GET /ask?q=...&k=4
Response:

json
Kopiera kod
{
  "ok": true,
  "query": "What is the capital of Sweden?",
  "topK": 4,
  "chunks": [
    { "ref": "#1", "score": 0.9056, "text": "Stockholm is the capital of Sweden." }
  ],
  "answer": "According to the context, the capital of Sweden is Stockholm.",
  "citations": [
    { "id": 1, "meta": { "source": "demo" } }
  ]
}
DELETE /delete/:id
Deletes from D1 and Vectorize. Returns 204 No Content.

Project structure
csharp
Kopiera kod
public/              # Static UI (index.html, style.css, screenshot.png)
src/
  app.js             # Hono routes (ingest, ask, delete, ping) – Worker entry
  embeddings.js      # Workers AI embeddings + chat helpers
  retrieval.js       # Chunking + Vectorize top-K retrieval
  store.js           # D1 helpers (insert/get/delete)
wrangler.toml        # Cloudflare bindings (AI, D1, Vectorize, assets)
package.json         # scripts: dev/deploy

compatibility_flags = ["nodejs_compat"] is enabled to keep optional local code paths. You can remove it later if you strip Node-only fallbac

How it works (short)

Ingest: split text → embed (@cf/baai/bge-base-en-v1.5) → insert row in D1 → upsert vector in Vectorize with matching id.

Ask: embed query → VECTOR_INDEX.query(topK) → fetch full text/metadata from D1 → call Workers AI chat model with the context → return answer + citations.

Branches

main (or cloudflare) — edge deployment (this)

local-xenova — local embeddings + Express + memory.json