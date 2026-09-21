/**
 * Selects the Repository implementation once at process startup: Postgres if DATABASE_URL is
 * set, otherwise the in-memory scaffold (seeded from data/synthetic/ on first API request).
 */
import { isPostgresConfigured, getPool } from "../db";
import { createMemoryRepository } from "./memory";
import { createPostgresRepository } from "./postgres";
import type { Repository } from "./types";

let repository: Repository | undefined;

export function getRepository(): Repository {
  if (!repository) {
    repository = isPostgresConfigured()
      ? createPostgresRepository(getPool())
      : createMemoryRepository();
    console.log(`[backend] using ${repository.kind} repository`);
  }
  return repository;
}

export type { Repository, TicketSnapshot, UpdateTicketResult, IngestOutcome } from "./types";
