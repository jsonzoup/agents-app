const EMBEDDING_DIMENSIONS = 384;

function hash(value: string): number {
  let current = 2166136261;
  for (const character of value) {
    current ^= character.codePointAt(0) ?? 0;
    current = Math.imul(current, 16777619);
  }
  return current >>> 0;
}

function addToken(vector: Float64Array, token: string, weight: number): void {
  if (!token) return;
  vector[hash(token) % EMBEDDING_DIMENSIONS] += weight;
}

/**
 * Produces a deterministic local lexical vector. The same projection is used
 * for documents and queries, so WeKnora's sqlite-vec index runs without a
 * remote embedding provider while the local runtime is managed by this app.
 */
export function embedTextLocally(text: string): number[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase().trim();
  const vector = new Float64Array(EMBEDDING_DIMENSIONS);
  const tokens =
    normalized.match(/[a-z0-9][a-z0-9._/+:#%-]*|[\u3400-\u9fff]/g) ?? [];
  for (const token of tokens) addToken(vector, token, token.length > 1 ? 1.8 : 1);
  const characters = [...normalized];
  for (const width of [2, 3, 4]) {
    for (let index = 0; index + width <= characters.length; index += 1) {
      addToken(
        vector,
        characters.slice(index, index + width).join(""),
        width === 2 ? 0.55 : 0.3,
      );
    }
  }
  for (const word of normalized.split(/\s+/)) addToken(vector, word, 1.4);
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => value / norm);
}

export const localEmbeddingDimensions = EMBEDDING_DIMENSIONS;
