# Mini-RAG (Cloudflare Edge)

Small Retrieval-Augmented Generation app at the edge:
- Router: Hono (Cloudflare Workers)
- Storage: D1 (SQLite serverless)
- Vector search: Vectorize
- Models: Workers AI (embeddings + chat)
- Static UI: served from `/public`

> The local/Ollama version lives in branch `local-xenova`.

---

## Quick start

**Prereqs**
- Node 18+
- Cloudflare account + Wrangler CLI (`npx wrangler login`)

**Install**
```bash
npm i



Provision (one-time)

# D1 (copy the printed database_id into wrangler.toml)
npx wrangler d1 create mini_rag_db

# Vector index (768 dims, cosine)
npx wrangler vectorize create mini_rag_vectors --dimensions=768 --metric=cosine

# Table
npx wrangler d1 execute mini_rag_db --remote --command "CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, text TEXT NOT NULL, meta TEXT);"


Dev

npm run dev
# http://127.0.0.1:8787


Deploy

npm run deploy
# -> https://mini-rag-edge.<your-subdomain>.workers.dev


API
POST /ingest

Body:

{ "text": "Stockholm is the capital of Sweden.", "meta": { "source": "demo" } }


Response:

{ "ok": true, "chunksAdded": 1 }

GET /ask?q=...&k=4

Response:

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

204 No Content

GET /ping

Health check.



Structure
public/           # static UI (index.html, style.css)
src/
  app.js          # Hono routes (ingest, ask, delete, ping) – Worker entry
  embeddings.js   # Workers AI (embed + chat)
  retrieval.js    # chunking + Vectorize top-K
  store.js        # D1 helpers (insert/get/delete)
wrangler.toml     # bindings (AI, D1, Vectorize) + assets
package.json      # dev/deploy scripts
