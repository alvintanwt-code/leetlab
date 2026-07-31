import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: join(__dirname),
  },
  serverExternalPackages: ["better-sqlite3", "@sparticuz/chromium", "puppeteer-core"],
  // @sparticuz/chromium ships a ~50 MB compressed Chromium binary in its
  // `bin/` directory. `serverExternalPackages` stops the bundler from
  // inlining the package, but Next.js's output tracer still needs to be
  // told to include those binary files in the Vercel function bundle —
  // otherwise the runtime error is `The input directory
  // "/var/task/node_modules/@sparticuz/chromium/bin" does not exist`.
  outputFileTracingIncludes: {
    "/api/factsheet/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
