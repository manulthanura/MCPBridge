/**
 * Infrastructure: PostgreSQL implementation of the DatabaseGateway port.
 *
 * Defence in depth: reads run inside BEGIN TRANSACTION READ ONLY, so even a
 * statement that slipped past the domain validator cannot mutate anything —
 * PostgreSQL itself rejects writes in a read-only transaction. Writes run in
 * their own transaction and roll back on any failure.
 */
import pg from 'pg';
import {
  DatabaseGateway,
  QueryResultData,
  WriteResultData,
} from './DatabaseGateway.js';
import { mapPgError } from './pool.js';

export class PostgresDatabaseGateway implements DatabaseGateway {
  constructor(
    private readonly pool: pg.Pool,
    private readonly secrets: string[],
  ) {}

  async executeReadOnly(sql: string): Promise<QueryResultData> {
    const started = Date.now();
    const client = await this.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const result = await client.query(sql);
      await client.query('COMMIT');
      return {
        rows: result.rows as Record<string, unknown>[],
        fields: (result.fields ?? []).map((f) => f.name),
        rowCount: result.rows.length,
        durationMs: Date.now() - started,
      };
    } catch (e) {
      await this.safeRollback(client);
      throw mapPgError(e, this.secrets);
    } finally {
      client.release();
    }
  }

  async executeWrite(sql: string): Promise<WriteResultData> {
    const started = Date.now();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(sql);
      await client.query('COMMIT');
      return {
        rowsAffected: result.rowCount ?? 0,
        returnedRows: result.rows as Record<string, unknown>[],
        durationMs: Date.now() - started,
      };
    } catch (e) {
      await this.safeRollback(client);
      throw mapPgError(e, this.secrets);
    } finally {
      client.release();
    }
  }

  async explain(sql: string, analyze: boolean): Promise<string[]> {
    const options = analyze ? 'ANALYZE, BUFFERS, FORMAT TEXT' : 'FORMAT TEXT';
    const result = await this.executeReadOnly(`EXPLAIN (${options}) ${sql}`);
    return result.rows.map((row) => String(row['QUERY PLAN']));
  }

  async estimateRows(sql: string): Promise<number | null> {
    // EXPLAIN without ANALYZE never executes the statement — safe for writes.
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
      await client.query('ROLLBACK');
      const planRow = result.rows[0] as { 'QUERY PLAN'?: Array<{ Plan?: { 'Plan Rows'?: number } }> };
      const rows = planRow?.['QUERY PLAN']?.[0]?.Plan?.['Plan Rows'];
      return typeof rows === 'number' ? Math.round(rows) : null;
    } catch (e) {
      await this.safeRollback(client);
      throw mapPgError(e, this.secrets);
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch (e) {
      throw mapPgError(e, this.secrets);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async connect(): Promise<pg.PoolClient> {
    try {
      return await this.pool.connect();
    } catch (e) {
      throw mapPgError(e, this.secrets);
    }
  }

  private async safeRollback(client: pg.PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection is gone; release() below returns it for disposal.
    }
  }
}
