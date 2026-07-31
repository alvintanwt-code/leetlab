import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: join(__dirname),
  },
  serverExternalPackages: ["better-sqlite3", "@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
