// Model: @cf/baai/bge-base-en-v1.5 (dim=768)

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

/**
 * Create an embedding vector for the given text.
 * @param {string} text
 * @param {any} env  Cloudflare env (must include AI binding)
 * @returns {Promise<number[]>}
 */
export async function embed(text, env) {
  if (!env?.AI) throw new Error('AI binding missing');
  const out = await env.AI.run(EMBEDDING_MODEL, { text });
  const vec = out?.data?.[0];
  if (!Array.isArray(vec)) throw new Error('Failed to generate embedding');
  return vec;
}