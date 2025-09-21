import { Hono } from 'hono';
import { topKByVectorize } from './retrieval.js';
import { insertChunk, deleteChunk, getChunkById } from './store.js';
import { embed } from './embeddings.js';

const CHAT_MODEL = '@cf/meta/llama-3-8b-instruct';

// --- utils ---
function chunkText(text, chunkSize = 800, overlap = 120) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    const slice = text.slice(i, end).trim();
    if (slice) chunks.push(slice);
    if (end === text.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

async function answerWithWorkersAI(env, question, context) {
  const messages = [
    { role: 'system', content: [
        'You are a STRICT retrieval assistant.',
        'Use ONLY the provided context between <context> ... </context>.',
        'If the answer is not clearly contained in the context, reply EXACTLY: "I don\'t know."',
        'Do NOT add external facts or world knowledge.',
        'Keep answers short.'
      ].join(' ')
    },
    ...(context ? [{ role: 'system', content: `<context>\n${context}\n</context>` }] : []),
    { role: 'user', content: question }
  ];

  try {
    const resp = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages,
      temperature: 0,
      max_tokens: 256
    });
    let s = typeof resp?.response === 'string' ? resp.response : '';
    // strip angle/quotes + trim
    s = s.replace(/^[\s<"]+|[\s>"]+$/g, '').trim();
    return s;
  } catch {
    return '';
  }
}



const app = new Hono();

// health
app.get('/ping', (c) => c.json({ ok: true }));

// ingest
app.post('/ingest', async (c) => {
  try {
    const body = await c.req.json();
    const clean = (body?.text || '').trim();
    const meta = body?.meta ?? null;
    if (!clean) return c.json({ ok: false, error: 'Missing "text" in body' }, 400);

    const parts = chunkText(clean, 800, 120);
    let added = 0;

    //only embed+upsert when inserted is true. Only then -> increment added
    for (const part of parts) {
      const row = await insertChunk(c.env, { text: part, meta });
      if (row.inserted) {                       // <— gate on new row only
        const vec = await embed(part, c.env);
        await c.env.VECTOR_INDEX.upsert([{ id: String(row.id), values: vec }]);
        added++;
      }
    }

    const { results } = await c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM chunks')
      .run();
    const total = Number(results?.[0]?.n ?? 0);

    return c.json({ ok: true, chunksAdded: added, total, totalChunks: total });
  } catch (e) {
    console.error('INGEST error:', e);
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// ask
app.get('/ask', async (c) => {
  try {
    const q = (c.req.query('q') || '').toString().trim();
    const k = Math.max(1, Math.min(8, parseInt(c.req.query('k')) || 4));
    if (!q) return c.json({ ok: false, error: 'Missing query ?q=' }, 400);

    const top = await topKByVectorize(c.env, q, k);
    const context = top.map(item => `[${item.ref}] ${item.text}`).join('\n\n');

    let answer = '';
    if (top.length === 0) {
      answer = "I don't know. (No relevant context was found.)";
    } else {
      answer = await answerWithWorkersAI(c.env, q, context);
      // if blank or says I don't know, give a grounded snippet
      if (!answer || /i don't know/i.test(answer)) {
        const snippet = top[0].text.slice(0, 160).replace(/\s+/g, ' ').trim();
        answer = `Based on the context: ${snippet}`;
      }
    }


    return c.json({
      ok: true,
      query: q,
      topK: k,
      chunks: top.map(({ ref, score, text }) => ({ ref, score, text })),
      answer,
      citations: top.map(({ id, meta }) => ({ id, meta }))
    });
  } catch (e) {
    console.error('ASK error:', e);
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// delete one
app.delete('/delete/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.text('Invalid id', 400);
    await deleteChunk(c.env, id);
    await c.env.VECTOR_INDEX.deleteByIds([String(id)]);
    return c.body(null, 204);
  } catch (e) {
    console.error('DELETE error:', e);
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// list (UI expects preview + idx)
app.get('/list', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, text, meta FROM chunks ORDER BY id DESC LIMIT 200')
    .run();

  const items = results.map((r, idx) => {
    const preview = r.text.length > 200 ? r.text.slice(0, 200) + '…' : r.text;
    return {
      id: r.id,
      idx,                // old UI may show this
      preview,            // old UI calls .replace(...) on this
      text: r.text,       // keep full text too
      meta: r.meta ? JSON.parse(r.meta) : null
    };
  });

  return c.json({ items, total: items.length });
});


// clear all (return 204 as old UI did)
app.post('/clear', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT id FROM chunks').run();
    const ids = results.map(r => String(r.id));
    const BATCH = 256;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      if (batch.length) await c.env.VECTOR_INDEX.deleteByIds(batch);
    }
    await c.env.DB.prepare('DELETE FROM chunks').run();
    return c.body(null, 204);
  } catch (e) {
    console.error('CLEAR error:', e);
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// export (download)
app.get('/export', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, text, meta FROM chunks ORDER BY id')
    .run();
  const payload = {
    items: results.map(r => ({
      id: r.id,
      text: r.text,
      meta: r.meta ? JSON.parse(r.meta) : null
    }))
  };
  c.header('content-type', 'application/json');
  c.header('content-disposition', 'attachment; filename="memory-export.json"');
  return c.body(JSON.stringify(payload, null, 2));
});

// minimal root
app.get('/', (c) => c.text('OK'));


// debug: show raw Vectorize matches for a question (no hydration)
app.get('/debug/vec', async (c) => {
  const q = (c.req.query('q') || '').toString().trim();
  if (!q) return c.json({ error: 'Missing ?q=' }, 400);
  const out = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: q });
  const qVec = out?.data?.[0] || [];
  const res = await c.env.VECTOR_INDEX.query(qVec, { topK: 5 });
  return c.json({ topK: 5, matches: res?.matches || [] });
});


export default app;
