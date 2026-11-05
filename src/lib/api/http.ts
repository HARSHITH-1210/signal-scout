import { NextResponse } from "next/server";
import { logError } from "../config";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export const badRequest = (error: string, fieldErrors?: Record<string, string>) =>
  json({ error, ...(fieldErrors ? { fieldErrors } : {}) }, 400);

export const notFound = (what = "Run") => json({ error: `${what} not found.` }, 404);

export const conflict = (error: string) => json({ error }, 409);

/**
 * Parses a JSON body without throwing; returns undefined for malformed input or a non-JSON content type.
 * Requiring application/json also forces a CORS preflight for any cross-site attempt.
 */
export async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return undefined;
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Wraps a handler so unexpected errors become a safe 500 (details only in the redacted server log). */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      logError("API handler", error);
      return json({ error: "Something went wrong on the server. Check the server log for details." }, 500);
    }
  };
}
