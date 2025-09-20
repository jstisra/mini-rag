/**
 * app.js — Cloudflare Workers (Hono) version
 *
 * What it does:
 *   - Exposes the same API shape you had: /ping, /ingest, /ask, /delete/:id
 *   - Uses Cloudflare bindings:
 *       - env.DB (D1) for storing text chunks + metadata
 *       - env.VECTOR_INDEX (Vectorize) for embeddings search
 *       - env.AI (Workers AI) for embeddings + chat/answer
 *
 * Why Hono (not Express):
 *   - Express doesn't run on Workers; Hono is a tiny router designed for Workers.
 *
 * Notes:
 *   - This file is the Worker entry (set main="src/app.js" in wrangler.toml).
 *   - Your old Node server (server.js) is for the local-xenova branch only.
 */

import { Hono } from 'hono';
import { chunkText, topKByVectorize } from './retrieval.js';
import { insertChunk, deleteChunk } from './store.js';
import { embed } from './embeddings.js';

// --- Models (easy to swap later) ---
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const CHAT_MODEL = '@cf/meta/llama-3-8b-instruct';

// Small helper: call Workers AI chat with context grounding
async function answerWithWorkersAI(env, question, context) {
  const messages = [
    // Keep context separate and instruct the model to only use it
    ...(context ? [{ role: 'system', content: `Context:\n${context}` }] : []),
    { role: 'system', content: 'Use ONLY the provided context. If missing, say you do not know. Answer concisely.' },
    { role: 'user', content: question }
  ];

  const { response } = await env.AI.run(CHAT_MODEL, { messages });
  return response;
}

const app = new Hono();

// -------- Health --------
app.get('/ping', (c) => c.json({ ok: true }));

// -------- Ingest text --------
// Body: { text: string, meta?: any }
// 1) Split into chunks
// 2) Store each chunk in D1 (insertChunk) to get an id
// 3) Embed the chunk via Workers AI
// 4) Upsert vector into Vectorize with the same id
app.post('/ingest', async (c) => {
  try {
    const { text, meta } = await c.req.json();
    const clean = (text || '').trim();
    if (!clean) return c.json({ error: 'Missing "text" in body' }, 400);

    // 1) Split
    const chunks = chunkText(clean, 800, 120);

    let added = 0;
    for (const chunk of chunks) {
      // 2) D1 insert
      const row = await insertChunk(c.env, { text: chunk, meta });

      // 3) Workers AI embedding
      const vec = await embed(chunk, c.env); // uses EMBEDDING_MODEL under the hood

      // 4) Upsert to Vectorize
      await c.env.VECTOR_INDEX.upsert([{ id: String(row.id), values: vec }]);
      added++;
    }

    return c.json({ ok: true, chunksAdded: added });
  } catch (e) {
    console.error(e);
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// -------- Ask / Query --------
// Query params: ?q=...&k=4
// 1) Vectorize search to get topK ids
// 2) Build a context string from the matched chunks
// 3) Call Workers AI chat to get an answer grounded in that context
app.get('/ask', async (c) => {
  try {
    const q = (c.req.query('q') || '').toString().trim();
    const k = Math.max(1, Math.min(8, parseInt(c.req.query('k')) || 4));
    if (!q) return c.json({ error: 'Missing query ?q=' }, 400);

    const top = await topKByVectorize(c.env, q, k); // [{ref,score,id,text,meta},...]
    const context = top.map(item => `[${item.ref}] ${item.text}`).join('\n\n');

    // If nothing found, still return a friendly answer
    let answer;
    if (top.length === 0) {
      answer = "I don't know. (No relevant context was found.)";
    } else {
      answer = await answerWithWorkersAI(c.env, q, context);
    }

    // Keep response shape similar to your old one
    return c.json({
      ok: true,
      query: q,
      topK: k,
      chunks: top.map(({ ref, score, text }) => ({ ref, score, text })),
      answer,
      // Expose IDs + meta separately if a UI needs citations
      citations: top.map(({ id, meta }) => ({ id, meta }))
    });
  } catch (e) {
    console.error(e);
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// -------- Delete by id --------
// Removes the row from D1 and the vector from Vectorize
app.delete('/delete/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.text('Invalid id', 400);
    await deleteChunk(c.env, id);
    await c.env.VECTOR_INDEX.deleteByIds([String(id)]);
    return c.body(null, 204);
  } catch (e) {
    console.error(e);
    return c.json({ error: String(e?.message || e) }, 500);
  }
});


// simple home route so / doesn't 404
/**
app.get('/', (c) => {
  return c.text(
    'Mini-RAG Edge is running.\n' +
    'Try:\n' +
    'GET  /ping\n' +
    'POST /ingest  {"text":"..."}\n' +
    'GET  /ask?q=your+question\n'
  );
});*/


export default app;
