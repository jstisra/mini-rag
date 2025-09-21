// src/retrieval.js — Vectorize + D1 retrieval with keyword re-rank

import { getChunkById } from './store.js';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

/**
 * Query Vectorize using the question embedding, hydrate rows from D1,
 * then re-rank with a tiny keyword overlap boost so exact entities win.
 * Returns [{ ref, score, id, text, meta }]
 */
export async function topKByVectorize(env, question, k = 4) {
  if (!env?.VECTOR_INDEX) throw new Error('VECTOR_INDEX binding missing');

  // 1) Embed the question
  const out = await env.AI.run(EMBEDDING_MODEL, { text: question });
  const qVec = out?.data?.[0];
  if (!Array.isArray(qVec)) throw new Error('Failed to embed question');

  // 2) Query more than we need, so re-rank has room to work
  const res = await env.VECTOR_INDEX.query(qVec, { topK: Math.max(k, 12) });
  const matches = res?.matches || [];

  // 3) Hydrate + compute boosted scores
  const items = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const idNum = Number(m.id);
    let text = '';
    let meta = null;

    try {
      const row = await getChunkById(env, idNum);
      if (row) {
        text = row.text || '';
        meta = row.meta ? JSON.parse(row.meta) : null;
      }
    } catch (_) { /* ignore */ }

    const base = Number((m.score ?? 0).toFixed(4));
    const boosted = base + keywordBoost(question, text);
    items.push({
      ref: `#${i + 1}`,
      score: Number(boosted.toFixed(4)),
      id: idNum,
      text,
      meta
    });
  }

  // 4) Re-sort, drop blanks, return k
  return items
    .filter(it => it.text && it.text.trim().length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Tiny keyword overlap boost: each query token hit adds +0.05 (capped at +0.2)
function keywordBoost(q, text) {
  if (!q || !text) return 0;
  const stop = new Set([
    'the','is','are','in','of','and','to','a','an','where','what','which','who',
    'whats','how','does','do','did','on','at','for','with','from','by','about',
    'into','over','under','it','its','be','was','were','been'
  ]);
  const toks = q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && t.length > 2 && !stop.has(t));
  if (toks.length === 0) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const t of toks) if (hay.includes(t)) hits++;
  return Math.min(0.2, hits * 0.05);
}
