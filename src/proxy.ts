import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, checkRequest } from "./lib/api/guard";

/**
 * Runs before every page and API request: host allow-list (DNS rebinding), the app password when one
 * is set (hosted demos), and same-origin writes (CSRF).
 */
export function proxy(request: NextRequest) {
  // Render sets RENDER_EXTERNAL_HOSTNAME to the service's public name, so it needn't be listed by hand.
  const allowedHosts = [...(process.env.ALLOWED_HOSTS ?? "").split(","), process.env.RENDER_EXTERNAL_HOSTNAME ?? ""];
  const verdict = checkRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    allowedHosts,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  const authorised = checkBasicAuth({
    pathname: request.nextUrl.pathname,
    authorization: request.headers.get("authorization"),
    username: process.env.APP_USERNAME,
    password: process.env.APP_PASSWORD,
  });
  if (!authorised)
    return new NextResponse("Sign in to use Signal Scout.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Signal Scout", charset="UTF-8"' } });
  return NextResponse.next();
}

export const config = {
  // Everything except Next's own static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
