"use client";

export type SendResult = { ok: true; data: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string>; data?: unknown };

/** POST/PUT/DELETE JSON to an API route; on failure returns a user-facing message plus the response body. */
export async function send(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (HTTP ${res.status}).`, fieldErrors: data.fieldErrors, data };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check that it's running and try again." };
  }
}
