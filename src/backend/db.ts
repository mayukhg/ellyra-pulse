/**
 * Postgres connection pool. Only instantiated when DATABASE_URL is set — see
 * src/backend/repositories/index.ts for how the repository implementation is selected.
 */
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — cannot create a Postgres pool.");
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export function isPostgresConfigured(): boolean {
  return Boolean(process.env["DATABASE_URL"]);
}
