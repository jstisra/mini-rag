/**
 * (Cloud mode): use Cloudflare Vectorize + D1
 * - embeds the question via Workers AI
 * - queries nearest vectors
 * - hydrates full text via D1 by vector id
 *
 * @param {any} env  Cloudflare Worker env (must include VECTOR_INDEX and DB)
 * @param {string} question
 * @param {number} k
 * @returns {Promise<Array<{ref:string, score:number, text:string, id:number, meta?:any}>>}
 */
export async function topKByVectorize(env, question, k = 4) {
  if (!env?.VECTOR_INDEX) {
    throw new Error("VECTOR_INDEX binding missing. Did you configure wrangler.toml?");
  }

  // 1) embed the query using Workers AI
  const qVec = await embed(question, env);

  // 2) query nearest neighbors
  const result = await env.VECTOR_INDEX.query(qVec, { topK: k });
  const matches = result?.matches || [];

  // 3) hydrate text/metadata from D1 by ID
  const items = [];
  for (const [i, m] of matches.entries()) {
    const idNum = Number(m.id);
    const row = await getChunkById?.(env, idNum); // will work after we update store.js
    if (row) {
      items.push({
        ref: `#${i + 1}`,
        score: Number((m.score ?? 0).toFixed(4)),
        id: row.id,
        text: row.text,
        meta: row.meta ? JSON.parse(row.meta) : null,
      });
    }
  }
  return items;
}
