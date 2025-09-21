/**
 * store.js
 *
 * Dual-mode storage layer:
 *  - LOCAL (Node): keep the existing memory.json flow for dev.
 *  - CLOUD (Workers): use Cloudflare D1 (serverless SQLite) – no filesystem.
 * 
 * Exports (LOCAL):
 *  - loadMemory(), saveMemory(), listMemory(), size(), clearMemory(),
 *    importMemory(), addTextChunks(chunks, embedFunc), rawMemory()
 *
 * New (CLOUD):
 *  - insertChunk(env, { text, meta })
 *  - getChunkById(env, id)
 *  - deleteChunk(env, id)
 */

// --------- ENV DETECTION ----------
const isNode = typeof process !== "undefined" && !!process.versions?.node;

// We'll lazy-load Node modules ONLY in Node (so Cloudflare doesn't choke).
async function nodeFsPath() {
  if (!isNode) return null;
  const fs = (await import("fs/promises"));
  const path = await import("path");
  const url = await import("url");
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const DATA_DIR = path.join(__dirname, "..", "data");
  const DATA_FILE = path.join(DATA_DIR, "memory.json");
  return { fs: fs.default ?? fs, path, DATA_DIR, DATA_FILE };
}

// --------- IN-MEMORY STATE (LOCAL) ----------
const MEMORY = []; // { id, text, embedding }
let NEXT_ID = 1;

// ---------- LOCAL FUNCTIONS (work in Node; no-op or safe in Workers) ----------

export async function loadMemory() {
  if (!isNode) return; // no-op in Workers
  try {
    const { fs, DATA_FILE } = await nodeFsPath();
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const { nextId, items } = JSON.parse(raw);
    MEMORY.length = 0;
    for (const it of items || []) MEMORY.push(it);
    NEXT_ID = nextId || (MEMORY.at(-1)?.id ?? 0) + 1;
    console.log(`Loaded ${MEMORY.length} chunks from disk.`);
  } catch {
    // first run or missing file – ignore
  }
}

export async function saveMemory() {
  if (!isNode) return; // no-op in Workers
  const { fs, DATA_DIR, DATA_FILE } = await nodeFsPath();
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = { nextId: NEXT_ID, items: MEMORY };
  await fs.writeFile(DATA_FILE, JSON.stringify(payload), "utf-8");
}

export function listMemory() {
  return MEMORY.map(({ id, text }, idx) => ({
    id,
    idx,
    preview: text.length > 200 ? text.slice(0, 200) + "…" : text,
  }));
}
export function size() {
  return MEMORY.length;
}

export function clearMemory() {
  MEMORY.length = 0;
  NEXT_ID = 1;
}

export function importMemory(nextId, items) {
  MEMORY.length = 0;
  for (const it of items) MEMORY.push(it);
  NEXT_ID = nextId || (MEMORY.at(-1)?.id ?? 0) + 1;
}

/**
 * LOCAL dev helper: add text chunks to MEMORY + persist to memory.json
 * embedFunc can be either embed(text) or embed(text, env) – we’ll call it flexibly.
 */
export async function addTextChunks(chunks, embedFunc, env) {
  for (const chunk of chunks) {
    const e =
      embedFunc.length >= 2 ? await embedFunc(chunk, env) : await embedFunc(chunk);
    MEMORY.push({ id: NEXT_ID++, text: chunk, embedding: e });
  }
  await saveMemory();
  return { added: chunks.length, total: MEMORY.length };
}



// Expose raw memory for your old cosine fallback
export function rawMemory() {
  return MEMORY;
}

// --- D1 helpers (Cloudflare workers) ---

/**
 * Insert a chunk if it's new (by content hash). If duplicate, return existing row.
 * @returns {Promise<{ id:number, text:string, meta:string, inserted:boolean }>}
 */
// Compute SHA-256 hex (already in your file)
async function sha256Hex(s) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Insert a chunk if it's new (by content hash). If duplicate, return existing row with inserted=false.
 */
export async function insertChunk(env, { text, meta }) {
  if (!env?.DB) throw new Error('D1 binding missing (env.DB)');
  const hash = await sha256Hex(text);

  // 1) check if exists
  let row;
  {
    const sel = await env.DB
      .prepare('SELECT id, text, meta, hash FROM chunks WHERE hash = ?')
      .bind(hash)
      .run();
    row = sel?.results?.[0] || null;
  }
  if (row) {
    return { id: row.id, text: row.text, meta: row.meta, inserted: false };
  }

  // 2) insert
  const ins = await env.DB
    .prepare('INSERT INTO chunks (text, meta, hash) VALUES (?, ?, ?) RETURNING id, text, meta, hash')
    .bind(text, JSON.stringify(meta ?? {}), hash)
    .run();
  const newRow = ins?.results?.[0];
  if (!newRow) throw new Error('Insert failed');
  return { id: newRow.id, text: newRow.text, meta: newRow.meta, inserted: true };
}


export async function getChunkById(env, id) {
  if (!env?.DB) throw new Error('D1 binding missing (env.DB)');
  const { results } = await env.DB
    .prepare('SELECT id, text, meta FROM chunks WHERE id = ?')
    .bind(id)
    .run();
  return results?.[0] || null;
}

export async function deleteChunk(env, id) {
  if (!env?.DB) throw new Error('D1 binding missing (env.DB)');
  await env.DB.prepare('DELETE FROM chunks WHERE id = ?').bind(id).run();
}
