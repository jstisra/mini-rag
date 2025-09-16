/**
 * embeddings.js
 *
 * What it does:
 *   - Turns text into a numeric vector (embedding).
 *   - Uses Xenova’s Transformers with a small MiniLM model (runs locally, no API needed).
 *
 * How it works:
 *   - Loads the model once and reuses it (singleton).
 *   - Combines token outputs into one vector using mean pooling.
 *   - Exports a single `embed(text)` function that returns an array of floats.
 *
 * Why it’s here:
 *   - Needed whenever we want to compare or search text.
 *   - Easy to swap out the model later (OpenAI, other local models, etc.).
 */
import { pipeline } from '@xenova/transformers';

// Singleton embedder init
let _embedder;
async function getEmbedder() {
  if (!_embedder) {
    _embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  }
  return _embedder;
}

// Mean-pool tokens → single vector
export async function embed(text) {
  const embedder = await getEmbedder(); //is model ready?
  const output = await embedder(text); //
  const data = output.data;
  const [ , seq, dim ] = output.dims;
  const vec = new Float32Array(dim);
  for (let t = 0; t < seq; t++) {
    const base = t * dim;
    for (let j = 0; j < dim; j++) vec[j] += data[base + j];
  }
  for (let j = 0; j < dim; j++) vec[j] /= seq;
  return Array.from(vec);
}
