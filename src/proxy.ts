import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "./lib/api/guard";
import { authEnabled, isEmailAllowed, isPublicPath, parseAllowList, SESSION_COOKIE, sessionSecret, verifySession } from "./lib/auth/session";

/**
 * Runs before every page and API request: host allow-list (DNS rebinding), same-origin writes (CSRF),
 * and Google sign-in when the OAuth client is configured.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Render sets RENDER_EXTERNAL_HOSTNAME to the service's public name, so it needn't be listed by hand.
  const allowedHosts = [...(process.env.ALLOWED_HOSTS ?? "").split(","), process.env.RENDER_EXTERNAL_HOSTNAME ?? ""];
  const verdict = checkRequest({
    method: request.method,
    pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    allowedHosts,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  if (!authEnabled(process.env)) {
    // Local use needs no sign-in. A public host must never run open.
    if (process.env.RENDER && pathname !== "/api/health")
      return new NextResponse("Sign-in isn't configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", { status: 503 });
    return NextResponse.next();
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, sessionSecret(process.env));
  const signedIn = session !== null && isEmailAllowed(session.email, parseAllowList(process.env.ALLOWED_EMAILS));
  if (pathname === "/signin" && signedIn) return NextResponse.redirect(new URL("/", request.url));
  if (signedIn || isPublicPath(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in to use Signal Scout." }, { status: 401 });
  const signin = new URL("/signin", request.url);
  if (pathname !== "/") signin.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signin);
}

export const config = {
  // Everything except Next's own static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
