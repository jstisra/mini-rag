/**
 * retrieval.js
 *
 * What it does:
 *   - Splits text into chunks and finds which ones are most similar to a query.
 *
 * How it works:
 *   - Breaks long text into overlapping chunks.
 *   - Calculates cosine similarity between vectors.
 *   - Ranks stored items against the query embedding.
 *
 * Why it’s here:
 *   - Handles the math + text logic only (no side effects).
 *   - Can be reused with any embedding model or storage system.
 */

import { rawMemory } from './store.js';

export function chunkText(text, chunkSize = 800, overlap = 120) {
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

export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return (!na || !nb) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function topKByCosine(qVec, k = 4) {
  const mem = rawMemory();
  return mem
    .map(it => ({ ...it, score: cosineSim(qVec, it.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r, i) => ({ ref: `#${i+1}`, score: Number(r.score.toFixed(4)), text: r.text }));
}
