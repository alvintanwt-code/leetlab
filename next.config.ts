import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: join(__dirname),
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
