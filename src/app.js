/**
 * app.js
 *
 * What it does:
 *   - Sets up all HTTP routes for the Mini RAG app.
 *
 * How it works:
 *   - Serves static files (like index.html).
 *   - Handles endpoints to add text/files into memory.
 *   - Lets users ask questions (retrieval + optional LLM).
 *   - Provides utilities: clear, list, export, import, ping.
 *
 * Why it’s here:
 *   - Acts as the main API layer.
 *   - Uses `store.js` and `retrieval.js` for the actual logic.
 *   - Keeps routes simple and separated from implementation details.
 */

import express from 'express';
import OpenAI from 'openai';
import { embed } from './embeddings.js';
import { chunkText, topKByCosine } from './retrieval.js';
import {
  addTextChunks, saveMemory, loadMemory, clearMemory,
  listMemory, size, importMemory
} from './store.js';

const openaiKey = process.env.OPENAI_API_KEY?.trim();
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

async function generateWithOllama(q, context) {
  const r = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.2',
      prompt:
        `You are a concise assistant. Use ONLY the context to answer.\n` +
        `If not found, say "I don't know". Match the user's language.\n\n` +
        `Context:\n${context}\n\nQuestion: ${q}\n\n` +
        `Answer in 1–3 sentences with citations like [#1].`,
      stream: false
    })
  });
  const data = await r.json();
  return data?.response || null;
}

export async function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static('public'));

  // health
  app.get('/ping', (_req, res) => res.json({ ok: true }));

  // ingest text
  app.post('/ingest', async (req, res) => {
    try {
      const text = (req.body?.text || '').trim();
      if (!text) return res.status(400).json({ error: 'Missing "text" in body' });

      const chunks = chunkText(text, 800, 120);
      const { added, total } = await addTextChunks(chunks, embed);
      res.json({ ok: true, chunksAdded: added, totalChunks: total });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ask
  app.get('/ask', async (req, res) => {
    try {
      const q = (req.query.q || '').toString().trim();
      const k = Math.max(1, Math.min(8, parseInt(req.query.k) || 4));
      if (!q) return res.status(400).json({ error: 'Missing query ?q=' });
      if (size() === 0) return res.status(400).json({ error: 'No documents ingested yet' });

      const qVec = await embed(q);
      const chunks = topKByCosine(qVec, k);
      const context = chunks.map(c => `[${c.ref}] ${c.text}`).join('\n\n');

      let answer = null;

      if (openai) {
        try {
          const prompt =
            `Use ONLY the context chunks. If missing, say you don't know.\n` +
            `Question: ${q}\n\nContext:\n${context}\n\n` +
            `Answer briefly with citations like [#1], [#2].`;
          const resp = await openai.responses.create({ model: 'gpt-4o-mini', input: prompt });
          answer = resp.output_text || null;
        } catch (e) {
          console.warn('OpenAI failed:', e.message || e);
        }
      }

      if (!answer) {
        try { answer = await generateWithOllama(q, context); }
        catch (e) { console.warn('Ollama failed:', e.message || e); }
      }

      if (!answer) {
        // fallback: just echo the chunks
        answer = chunks.map((c, i) => `• ${c.text} ([#${i+1}])`).join('\n');
      }

      res.json({ ok: true, query: q, topK: k, chunks, answer });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // stored chunks & utilities
  app.get('/list', (_req, res) => res.json({ total: size(), items: listMemory() }));

  app.post('/clear', async (_req, res) => {
    clearMemory();
    await saveMemory().catch(() => {});
    res.status(204).end();
  });

  app.get('/export', (_req, res) => {
    // simple export by reading via listMemory + raw vectors are already persisted in memory.json
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="memory.json"');
    res.send(JSON.stringify({ /* minimal pointer */ note: 'Use data/memory.json on disk for full export.' }, null, 2));
  });

  app.post('/import', async (req, res) => {
    try {
      const { nextId, items } = req.body || {};
      if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid file format' });
      importMemory(nextId, items);
      await saveMemory();
      res.json({ ok: true, total: size() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // load memory at boot
  await loadMemory();
  return app;
}
