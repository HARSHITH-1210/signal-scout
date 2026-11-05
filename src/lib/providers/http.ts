/** Largest provider response we'll parse. Bigger bodies are refused rather than held in memory. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  constructor() {
    super("The provider returned an unexpectedly large response.");
    this.name = "ResponseTooLargeError";
  }
}

/** Reads a fetch Response as JSON with a hard size cap, streaming so an oversized body is cut off early. */
export async function readJsonCapped(response: Response, limit = MAX_RESPONSE_BYTES): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new ResponseTooLargeError();
  if (!response.body) return JSON.parse(await response.text());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
