/**
 * embeddings.js
 *
 * What it does:
 *   - Turns text into a numeric vector (embedding).
 *   - Uses Cloudflare Workers AI (hosted) — no local model / no Ollama needed.
 *
 * How it works:
 *   - Calls the embedding model through the Worker binding: env.AI.
 *   - Returns a plain array of floats (same shape you used before, just from CF).
 *
 * Usage:
 *   const vec = await embed("some text", c.env)
 *   // NOTE: pass the Cloudflare env from your route handler
 */

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/**
 * Create an embedding vector for the given text.
 * @param {string} text
 * @param {any} env  // Cloudflare env (must include AI binding)
 * @returns {Promise<number[]>}
 */
export async function embed(text, env) {
  if (!env || !env.AI) {
    throw new Error("Workers AI binding missing. Pass your Cloudflare env as the second argument to embed(text, env).");
  }

  // Cloudflare Workers AI: returns { data: [ Float32ArrayLike ] }
  const out = await env.AI.run(EMBEDDING_MODEL, { text });
  const vector = out?.data?.[0];
  if (!vector || !Array.isArray(vector)) {
    throw new Error("Failed to get embedding from Workers AI.");
  }
  return vector;
}
