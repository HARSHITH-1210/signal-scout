// Request guard shared by src/proxy.ts. Pure functions so the rules are unit-tested.

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Hosts the app answers to. A DNS-rebinding attack needs the browser to send an attacker-controlled
 * hostname, so names are allowed only if they can't be attacker-controlled: localhost, IP literals,
 * mDNS `.local` names, and anything listed in ALLOWED_HOSTS (comma-separated) for real deployments.
 */
export function isAllowedHost(hostHeader: string | null, allowedHosts: string[] = []): boolean {
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (IPV4.test(host) || host.includes(":")) return true; // IPv4 / IPv6 literal
  return allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
}

export type GuardVerdict = { ok: true } | { ok: false; status: number; error: string };

/**
 * Blocks cross-site writes (CSRF). Browsers send Origin on cross-site POSTs, even "simple" ones with a
 * text/plain body, and Sec-Fetch-Site on modern browsers. Same-origin requests and non-browser clients
 * (no Origin) pass; the app's own pages always send matching values.
 */
export function checkRequest(input: {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  allowedHosts?: string[];
}): GuardVerdict {
  if (!isAllowedHost(input.host, input.allowedHosts))
    return { ok: false, status: 421, error: "This host name isn't allowed. Open the app via localhost, or add the host to ALLOWED_HOSTS." };
  if (!input.pathname.startsWith("/api/") || !MUTATING.has(input.method.toUpperCase())) return { ok: true };
  if (input.secFetchSite === "cross-site") return { ok: false, status: 403, error: "Cross-site requests are not allowed." };
  if (input.origin && input.origin !== "null") {
    const originHost = (() => {
      try {
        return new URL(input.origin).host.toLowerCase();
      } catch {
        return null;
      }
    })();
    if (!originHost || originHost !== input.host?.toLowerCase()) return { ok: false, status: 403, error: "Cross-site requests are not allowed." };
  } else if (input.origin === "null") {
    return { ok: false, status: 403, error: "Requests from opaque origins are not allowed." };
  }
  return { ok: true };
}

/** Paths reachable without the app password: the uptime monitor's ping (it reports booleans only). */
const PUBLIC_PATHS = new Set(["/api/health"]);

function safeEqual(a: string, b: string): boolean {
  // Constant-time over the longer input, so timing doesn't reveal how much of the password matched.
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * HTTP Basic auth for hosted deployments, on when APP_PASSWORD is set. Local use (no password) is
 * unchanged. Browsers resend the credentials on every request to the origin, including the live
 * event stream and the Gmail sign-in redirect.
 */
export function checkBasicAuth(input: { pathname: string; authorization: string | null; username?: string; password?: string }): boolean {
  if (!input.password) return true;
  if (PUBLIC_PATHS.has(input.pathname)) return true;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(input.authorization?.trim() ?? "");
  if (!match) return false;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const at = decoded.indexOf(":");
  if (at === -1) return false;
  return safeEqual(decoded.slice(0, at), input.username || "demo") && safeEqual(decoded.slice(at + 1), input.password);
}
