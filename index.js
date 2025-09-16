import 'dotenv/config';
import express from 'express';
import { pipeline } from '@xenova/transformers';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json({ limit: '10mb' }));


// paths + data file (single source of truth)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, 'data');
const DATA_FILE  = path.join(DATA_DIR, 'memory.json');

// serve the static UI
app.use(express.static(path.join(__dirname, 'public')));


// ---------- tiny in-memory "DB" ----------
/** @type {{ id: number, text: string, embedding: number[] }[]} */
const MEMORY = [];
let NEXT_ID = 1;

// ---------- util: chunking ----------
function chunkText(text, chunkSize = 800, overlap = 120) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    const slice = text.slice(i, end);
    chunks.push(slice.trim());
    if (end === text.length) break;
    i = end - overlap; // step forward with overlap
    if (i < 0) i = 0;
  }
  return chunks.filter(c => c.length > 0);
}

// ---------- util: cosine similarity ----------
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- embeddings (local, free) ----------
const embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');

// mean-pool last hidden state -> 1 vector per text
async function embed(text) {
  const output = await embedder(text);
  // output: { data: Float32Array, dims: [1, seq_len, hidden] }
  const data = output.data;
  const [batch, seq, dim] = output.dims;
  const vec = new Float32Array(dim);
  // sum across tokens
  for (let t = 0; t < seq; t++) {
    const base = t * dim;
    for (let j = 0; j < dim; j++) vec[j] += data[base + j];
  }
  // mean
  for (let j = 0; j < dim; j++) vec[j] /= seq;
  // return as normal JS array
  return Array.from(vec);
}

// ---------- optional LLM client (only used if key works) ----------
const openaiKey = process.env.OPENAI_API_KEY?.trim();
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;


//--------Helpers---
async function saveMemory() {
  const payload = { nextId: NEXT_ID, items: MEMORY };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(payload), 'utf-8');
}


async function loadMemoryIfExists() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const { nextId, items } = JSON.parse(raw);
    MEMORY.length = 0;
    for (const it of items || []) MEMORY.push(it);
    NEXT_ID = nextId || (MEMORY.at(-1)?.id ?? 0) + 1;
    console.log(`Loaded ${MEMORY.length} chunks from disk.`);
  } catch { /* first run: file not found is fine */ }
}

//upload helper
async function extractPdfTextFromBuffer(buffer) {
  const loadingTask = getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(it => ('str' in it ? it.str : '')).filter(Boolean);
    fullText += strings.join(' ') + '\n\n';
  }
  await pdf.destroy();
  return fullText.trim();
}



// ---------- sanity route ----------
app.get('/', (_req, res) => {
  res.send('Hello RAG world 👋 (local embeddings, in-memory store)');
});

// ---------- INGEST: POST /ingest { text } ----------
app.post('/ingest', async (req, res) => {
  try {
    const text = (req.body?.text || '').trim();
    console.log('INGEST hit; text length =', text.length);
    if (!text) return res.status(400).json({ error: 'Missing "text" in body' });

    const chunks = chunkText(text, 800, 120);
    console.log('INGEST chunks =', chunks.length);
    if (chunks.length === 0) return res.status(400).json({ error: 'No usable text' });

    // embed + store
    for (const chunk of chunks) {
      const e = await embed(chunk);
      MEMORY.push({ id: NEXT_ID++, text: chunk, embedding: e });
    }
    //save after ingest
    await saveMemory();

    res.json({ ok: true, chunksAdded: chunks.length, totalChunks: MEMORY.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});



function naiveAnswerFromChunks(q, ranked) {
  // super simple: return a brief summary made of the top chunks
  const lines = ranked.map((r, i) => `• ${r.text} [${i+1}]`);
  return [
    `Sammanfattning baserat på de mest relevanta bitarna (kan vara förenklad):`,
    ...lines
  ].join('\n');
}

//Helper- Added for Ollama
async function generateWithOllama(q, context) {
  const r = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.2',
      prompt:
        `You are a concise assistant. Use ONLY the context to answer.\n` +
        `If the answer isn't in the context, say "I don't know".\n` +
        `Always answer in the same language as the input question.\n\n` +
        `Context:\n${context}\n\nQuestion: ${q}\n\n` +
        `Write 1–3 sentences max and include citations like [#1], [#2].`,
      stream: false
    })
  });
  const data = await r.json();
  return data?.response || null;
}



// ---------- ASK: GET /ask?q=...&k=4 ----------
app.get('/ask', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const k = Math.max(1, Math.min(8, parseInt(req.query.k) || 4));
    if (!q) return res.status(400).json({ error: 'Missing query ?q=' });
    if (MEMORY.length === 0) return res.status(400).json({ error: 'No documents ingested yet' });

    // embed the question
    const qVec = await embed(q);

    // rank by cosine similarity
    const ranked = MEMORY
      .map(item => ({ ...item, score: cosineSim(qVec, item.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    // always return top chunks (works even without an API key)
    const context = ranked.map((r, i) => `[#${i + 1}] ${r.text}`).join('\n\n');

    // if we have a working OpenAI key, try to generate an answer
let answer = null;

// 1) try OpenAI if you have credits
if (openai) {
  try {
    const prompt =
      `You are a helpful assistant. Use ONLY the context chunks if relevant. ` +
      `If missing, say you don't know.\n\nQuestion: ${q}\n\nContext:\n${context}\n\n` +
      `Answer briefly in bullets and cite chunks like [#1], [#2].`;
    const resp = await openai.responses.create({ model: 'gpt-4o-mini', input: prompt });
    answer = resp.output_text || null;
  } catch (e) {
    console.warn('OpenAI failed:', e.message || e);
  }
}

// 2) if no OpenAI (or failed), try Ollama locally
if (!answer) {
  try {
    answer = await generateWithOllama(q, context);
  } catch (e) {
    console.warn('Ollama failed:', e.message || e);
  }
}

// 3) last resort: naive summary from chunks
if (!answer) {
  answer = naiveAnswerFromChunks(q, ranked);
}


    res.json({
      ok: true,
      query: q,
      topK: k,
      chunks: ranked.map((r, i) => ({ ref: `#${i + 1}`, score: Number(r.score.toFixed(4)), text: r.text })),
      answer: answer, // may be null if no key or call failed
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/*Add /clear endpoint*/
app.post('/clear', async (_req, res) => {
  MEMORY.length = 0;
  NEXT_ID = 1;
  try { await fs.unlink(DATA_FILE); } catch {}
  res.status(204).end();
});



/*load on startup*/
await loadMemoryIfExists();


/*route to list stored chunks */
app.get('/list', (_req, res) => {
  res.json({
    total: MEMORY.length,
    items: MEMORY.map(({ id, text }, idx) => ({
      id,
      idx,
      preview: text.length > 200 ? text.slice(0, 200) + '…' : text,
    })),
  });
});





/**export memory */
app.get('/export', (_req, res) => {
  const payload = { nextId: NEXT_ID, items: MEMORY };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="memory.json"');
  res.send(JSON.stringify(payload, null, 2));
});

// IMPORT: POST /import
app.post('/import', async (req, res) => {
  try {
    const { nextId, items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Invalid file format' });
    }
    MEMORY.length = 0;
    for (const it of items) MEMORY.push(it);
    NEXT_ID = nextId || (MEMORY.at(-1)?.id ?? 0) + 1;
    await saveMemory();
    res.json({ ok: true, total: MEMORY.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

//-----Debug routes----

// quick health checks
app.get('/ping', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// log every request (method + url)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});


app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
