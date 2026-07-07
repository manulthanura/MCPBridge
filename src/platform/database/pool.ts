/**
 * Infrastructure: shared PostgreSQL pool factory and error mapping. The
 * gateway and the introspector share one pool so connection limits are
 * enforced globally.
 */
import pg from 'pg';
import {
  GatewayErrorCode,
  GatewayQueryError,
} from './DatabaseGateway.js';
import { AppConfig, redactSecrets } from '../config/Config.js';

export function createPool(config: AppConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    // Requests queue for a connection but give up rather than hang (R-02).
    connectionTimeoutMillis: 10_000,
    statement_timeout: config.queryTimeoutMs,
    application_name: 'mcpbridge',
  });
  // An idle client erroring (server restart, network drop) must not crash
  // the process; the pool replaces it on the next checkout (R-01).
  pool.on('error', (e) => {
    console.error('[mcpbridge] idle database client error:', redactSecrets(e.message, config.secrets));
  });
  return pool;
}

interface PgErrorLike {
  code?: string;
  message: string;
  position?: string;
  hint?: string;
}

/**
 * Maps a pg error to the gateway's stable error surface, redacting secrets.
 * PostgreSQL error codes: class 42 = syntax/access, 57014 = cancelled
 * (statement_timeout), class 08 = connection, 28xxx = auth.
 */
export function mapPgError(e: unknown, secrets: string[]): GatewayQueryError {
  const pgError = e as PgErrorLike;
  const message = redactSecrets(pgError.message ?? String(e), secrets);
  const code = pgError.code ?? '';

  let mapped: GatewayErrorCode = 'db_error';
  let hint: string | undefined = pgError.hint ? redactSecrets(pgError.hint, secrets) : undefined;

  if (code === '42601') {
    mapped = 'syntax_error';
  } else if (code === '57014') {
    mapped = 'query_timeout';
    hint = hint ?? 'The query exceeded the configured timeout. Narrow it with WHERE clauses or indexes.';
  } else if (code.startsWith('08') || code.startsWith('28') || code === '3D000' || code === 'ECONNREFUSED') {
    mapped = 'connection_error';
    hint = hint ?? 'Check that PostgreSQL is running and the connection settings are correct.';
  } else if (code === '42501') {
    mapped = 'permission_denied';
  }

  const position = pgError.position ? Number(pgError.position) : undefined;
  return new GatewayQueryError(mapped, message, Number.isFinite(position) ? position : undefined, hint);
}

/** Quotes a PostgreSQL identifier ("users", "my table", schema.table parts). */
export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
