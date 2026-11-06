/**
 * Recall by meaning (MEM-13): sentence vectors from a small local model (all-MiniLM-L6-v2), compared by cosine, and the
 * result blended with the keyword (bm25) ranking by reciprocal rank fusion. Pure: the model runs elsewhere.
 */

/** The model's token vectors (tokens x dim, row-major), averaged and scaled to length 1, as sentence-transformers does. */
export const meanPool = (hidden: Float32Array, tokens: number, dim: number): Float32Array => {
  const out = new Float32Array(dim);
  for (let t = 0; t < tokens; t += 1) {
    for (let d = 0; d < dim; d += 1) out[d]! += hidden[t * dim + d]!;
  }
  let norm = 0;
  for (let d = 0; d < dim; d += 1) {
    out[d]! /= tokens;
    norm += out[d]! * out[d]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dim; d += 1) out[d]! /= norm;
  return out;
};

/** Both are unit length, so the dot product is the cosine. */
export const cosine = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) dot += a[i]! * b[i]!;
  return dot;
};

/** The `k` nearest of `entries` at or above `floor`, nearest first. */
export const nearest = <T>(
  query: Float32Array,
  entries: ReadonlyArray<{ readonly key: T; readonly vector: Float32Array }>,
  k: number,
  floor: number,
): ReadonlyArray<{ readonly key: T; readonly score: number }> =>
  entries
    .map(({ key, vector }) => ({ key, score: cosine(query, vector) }))
    .filter((hit) => hit.score >= floor)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, k);

/** Reciprocal rank fusion: each list gives 1/(k + rank); an item high in both wins, either alone still counts. */
export const rrf = (
  lists: ReadonlyArray<ReadonlyArray<string>>,
  k = 60,
): ReadonlyMap<string, number> => {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((key, rank) => score.set(key, (score.get(key) ?? 0) + 1 / (k + rank + 1)));
  }
  return score;
};

/** A vector as the bytes SQLite keeps (little-endian float32), and back. */
export const vectorToBytes = (vector: Float32Array): Uint8Array =>
  new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
export const vectorFromBytes = (bytes: Uint8Array): Float32Array => {
  const copy = new Uint8Array(bytes);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
};
