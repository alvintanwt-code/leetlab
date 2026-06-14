import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL missing — set it in .env.local (Neon connection string)");
  }
  const sqlClient = neon(url);
  _db = drizzle(sqlClient, { schema });
  return _db;
}

export { schema };
