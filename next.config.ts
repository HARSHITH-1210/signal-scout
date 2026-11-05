import type { NextConfig } from "next";
import os from "node:os";

/**
 * In dev, Next.js blocks its client scripts for any host other than localhost, which silently breaks
 * every form when the app is opened via the machine's network address (e.g. http://192.168.x.x:3000).
 * Trust this machine's own addresses only; nothing external is allowed.
 */
const ownAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a): a is os.NetworkInterfaceInfo => Boolean(a) && !a!.internal && a!.family === "IPv4")
  .map((a) => a.address);

const nextConfig: NextConfig = {
  // Native SQLite binding must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  output: "standalone",
  allowedDevOrigins: [...new Set([...ownAddresses, os.hostname(), os.hostname().replace(/\.local$/, "") + ".local"])],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
