/**
 * run-migration.ts
 *
 * Apply a single .sql file against the Postgres instance pointed to by
 * DATABASE_URL in .env. Wraps the whole file in one transaction and rolls
 * back on any error. Used for schema changes (DDL) that PostgREST cannot
 * execute directly.
 *
 * Usage:
 *   npm run migrate supabase/migrations/011_relax_jobs_source_enum.sql
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

async function main(): Promise<number> {
  const argPath = process.argv[2];
  if (!argPath) {
    console.error('Usage: npm run migrate <path/to/migration.sql>');
    return 1;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is not set. Add it to .env -- see .env.example for the format.'
    );
    return 1;
  }

  const sqlPath = resolve(argPath);
  const sql = await readFile(sqlPath, 'utf8');
  if (!sql.trim()) {
    console.error(`Migration file is empty: ${sqlPath}`);
    return 1;
  }

  console.log(`[run-migration] file: ${sqlPath}`);
  console.log(`[run-migration] bytes: ${sql.length}`);

  // Supabase pooler requires SSL. `ssl: { rejectUnauthorized: false }` is
  // the standard posture for the pooler which uses a Supabase-managed cert.
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('[run-migration] connected');

  try {
    await client.query('BEGIN');
    const result = await client.query(sql);
    await client.query('COMMIT');

    // `pg` returns either a single result or an array of results depending
    // on how many statements the driver split the text into. Normalize so
    // we can print a readable summary.
    const results = Array.isArray(result) ? result : [result];
    console.log(`[run-migration] statements executed: ${results.length}`);
    results.forEach((r, i) => {
      const cmd = (r as { command?: string }).command ?? '(unknown)';
      const rc = (r as { rowCount?: number | null }).rowCount ?? 0;
      console.log(`[run-migration]   ${i + 1}. ${cmd} -> rowCount=${rc}`);
    });

    console.log('[run-migration] COMMIT ok');
    return 0;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
      console.error('[run-migration] ROLLBACK applied');
    } catch {
      // ignore rollback errors; surface the original error
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[run-migration] FAILED: ${msg}`);
    return 1;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[run-migration] unexpected error: ${msg}`);
    process.exit(1);
  });
