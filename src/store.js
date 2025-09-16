/**
 * store.js
 *
 * What it does:
 *   - Keeps all text + embeddings in memory and saves them to disk (memory.json).
 *   - Works like a small database with basic CRUD functions.
 *
 * How it works:
 *   - Loads memory.json when the app starts, saves after changes.
 *   - Supports adding, clearing, importing, and listing items.
 *   - Uses NEXT_ID to give each item a unique id.
 *
 * Why it’s here:
 *   - Acts as the single source of truth for stored data.
 *   - Other parts of the app (like search/retrieval) read from here.
 *   - If we move to a real database later, we only need to change this file.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, '..', 'data');
const DATA_FILE  = path.join(DATA_DIR, 'memory.json');

// In-memory state
const MEMORY = []; // { id, text, embedding }
let NEXT_ID = 1;

export async function loadMemory() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const { nextId, items } = JSON.parse(raw);
    MEMORY.length = 0;
    for (const it of (items || [])) MEMORY.push(it);
    NEXT_ID = nextId || (MEMORY.at(-1)?.id ?? 0) + 1;
    console.log(`Loaded ${MEMORY.length} chunks from disk.`);
  } catch { /* first run: fine */ }
}

export async function saveMemory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = { nextId: NEXT_ID, items: MEMORY };
  await fs.writeFile(DATA_FILE, JSON.stringify(payload), 'utf-8');
}

export function listMemory() {
  return MEMORY.map(({ id, text }, idx) => ({
    id, idx, preview: text.length > 200 ? text.slice(0, 200) + '…' : text
  }));
}
export function size() { return MEMORY.length; }

export function clearMemory() {
  MEMORY.length = 0;
  NEXT_ID = 1;
}

export function importMemory(nextId, items) {
  MEMORY.length = 0;
  for (const it of items) MEMORY.push(it);
  NEXT_ID = nextId || (MEMORY.at(-1)?.id ?? 0) + 1;
}

export async function addTextChunks(chunks, embedFunc) {
  for (const chunk of chunks) {
    const e = await embedFunc(chunk);
    MEMORY.push({ id: NEXT_ID++, text: chunk, embedding: e });
  }
  await saveMemory();
  return { added: chunks.length, total: MEMORY.length };
}

export function rawMemory() { return MEMORY; } // used by retrieval
