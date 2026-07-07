/**
 * Infrastructure: schema intelligence from PostgreSQL system catalogs.
 * Row counts come from planner statistics (pg_class.reltuples) — instant and
 * accurate enough for exploration, never a COUNT(*) on a big table.
 */
import pg from 'pg';
import { SchemaIntrospector } from '../application/SchemaIntrospector.js';
import {
  ColumnStatistics,
  Relationship,
  SchemaSnapshot,
  TableDetails,
  TableStatistics,
  TableSummary,
} from '../domain/types.js';
import { Clock } from '../../shared/domain/Clock.js';
import { mapPgError, quoteIdent } from '../../platform/database/pool.js';

export class PostgresSchemaIntrospector implements SchemaIntrospector {
  constructor(
    private readonly pool: pg.Pool,
    private readonly secrets: string[],
    private readonly clock: Clock,
  ) {}

  async listTables(schema: string): Promise<TableSummary[]> {
    const result = await this.query(
      `SELECT n.nspname AS schema,
              c.relname AS name,
              CASE c.relkind
                WHEN 'r' THEN 'table'
                WHEN 'p' THEN 'table'
                WHEN 'v' THEN 'view'
                WHEN 'm' THEN 'materialized view'
                WHEN 'f' THEN 'foreign table'
              END AS kind,
              GREATEST(c.reltuples, 0)::bigint AS estimated_rows,
              obj_description(c.oid, 'pg_class') AS description
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       ORDER BY c.relname`,
      [schema],
    );
    return result.rows.map((row) => ({
      schema: String(row.schema),
      name: String(row.name),
      kind: row.kind as TableSummary['kind'],
      estimatedRows: Number(row.estimated_rows),
      description: row.description === null ? null : String(row.description),
    }));
  }

  async describeTable(schema: string, table: string): Promise<TableDetails | null> {
    const summary = (await this.listTables(schema)).find((t) => t.name === table);
    if (!summary) return null;

    const [columns, foreignKeys, indexes] = await Promise.all([
      this.query(
        `SELECT a.attname AS name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS nullable,
                pg_get_expr(d.adbin, d.adrelid) AS default_value,
                COALESCE((
                  SELECT true FROM pg_index i
                  WHERE i.indrelid = a.attrelid AND i.indisprimary
                    AND a.attnum = ANY (i.indkey)
                ), false) AS is_primary_key
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE n.nspname = $1 AND c.relname = $2
           AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [schema, table],
      ),
      this.query(
        `SELECT con.conname AS constraint_name,
                src_col.attname AS column,
                tgt.relname AS references_table,
                tgt_col.attname AS references_column
         FROM pg_constraint con
         JOIN pg_class src ON src.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = src.relnamespace
         JOIN pg_class tgt ON tgt.oid = con.confrelid
         CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY
              AS cols(src_attnum, tgt_attnum, ord)
         JOIN pg_attribute src_col
              ON src_col.attrelid = src.oid AND src_col.attnum = cols.src_attnum
         JOIN pg_attribute tgt_col
              ON tgt_col.attrelid = tgt.oid AND tgt_col.attnum = cols.tgt_attnum
         WHERE con.contype = 'f' AND n.nspname = $1 AND src.relname = $2
         ORDER BY con.conname, cols.ord`,
        [schema, table],
      ),
      this.query(
        `SELECT i.relname AS name,
                pg_get_indexdef(ix.indexrelid) AS definition,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = $1 AND t.relname = $2
         ORDER BY i.relname`,
        [schema, table],
      ),
    ]);

    return {
      ...summary,
      columns: columns.rows.map((row) => ({
        name: String(row.name),
        dataType: String(row.data_type),
        nullable: Boolean(row.nullable),
        defaultValue: row.default_value === null ? null : String(row.default_value),
        isPrimaryKey: Boolean(row.is_primary_key),
      })),
      foreignKeys: foreignKeys.rows.map((row) => ({
        constraintName: String(row.constraint_name),
        column: String(row.column),
        referencesTable: String(row.references_table),
        referencesColumn: String(row.references_column),
      })),
      indexes: indexes.rows.map((row) => ({
        name: String(row.name),
        definition: String(row.definition),
        isUnique: Boolean(row.is_unique),
        isPrimary: Boolean(row.is_primary),
      })),
    };
  }

  async getRelationships(schema: string, table: string): Promise<Relationship[]> {
    const result = await this.query(
      `SELECT src.relname AS from_table,
              tgt.relname AS to_table,
              src_col.attname AS via_column,
              (src.relname = $2) AS is_outgoing,
              EXISTS (
                SELECT 1 FROM pg_index u
                WHERE u.indrelid = src.oid AND u.indisunique
                  AND u.indnkeyatts = 1
                  AND src_col.attnum = u.indkey[0]
              ) AS fk_is_unique
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_namespace sn ON sn.oid = src.relnamespace
       JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
       JOIN pg_attribute src_col
            ON src_col.attrelid = src.oid AND src_col.attnum = con.conkey[1]
       WHERE con.contype = 'f'
         AND sn.nspname = $1 AND tn.nspname = $1
         AND (src.relname = $2 OR tgt.relname = $2)
       ORDER BY src.relname, tgt.relname`,
      [schema, table],
    );

    return result.rows.map((row) => {
      const outgoing = Boolean(row.is_outgoing);
      const unique = Boolean(row.fk_is_unique);
      return {
        direction: outgoing ? 'outgoing' : 'incoming',
        fromTable: String(row.from_table),
        toTable: String(row.to_table),
        viaColumn: String(row.via_column),
        cardinality: unique ? 'one-to-one' : outgoing ? 'many-to-one' : 'one-to-many',
      };
    });
  }

  async getTableStatistics(schema: string, table: string): Promise<TableStatistics | null> {
    const result = await this.query(
      `SELECT GREATEST(c.reltuples, 0)::bigint AS estimated_rows,
              pg_total_relation_size(c.oid) AS total_size,
              pg_indexes_size(c.oid) AS index_size,
              s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
       WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'm')`,
      [schema, table],
    );
    const row = result.rows[0];
    if (!row) return null;

    const columnStats = await this.query(
      `SELECT attname AS column, null_frac, n_distinct
       FROM pg_stats
       WHERE schemaname = $1 AND tablename = $2
       ORDER BY attname`,
      [schema, table],
    );

    return {
      schema,
      table,
      estimatedRows: Number(row.estimated_rows),
      totalSizeBytes: Number(row.total_size),
      indexSizeBytes: Number(row.index_size),
      lastVacuum: latestTimestamp(row.last_vacuum, row.last_autovacuum),
      lastAnalyze: latestTimestamp(row.last_analyze, row.last_autoanalyze),
      columnStats: columnStats.rows.map(
        (statRow): ColumnStatistics => ({
          column: String(statRow.column),
          nullFraction: statRow.null_frac === null ? null : Number(statRow.null_frac),
          distinctValues: statRow.n_distinct === null ? null : Number(statRow.n_distinct),
        }),
      ),
    };
  }

  async getSampleRows(
    schema: string,
    table: string,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    // Identifiers cannot be parameterized; they are quote-escaped and the
    // limit is validated as a small integer.
    const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
    const result = await this.query(
      `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT ${safeLimit}`,
      [],
    );
    return result.rows as Record<string, unknown>[];
  }

  async getSchemaSnapshot(schema: string): Promise<SchemaSnapshot> {
    const summaries = await this.listTables(schema);
    const tables: TableDetails[] = [];
    for (const summary of summaries) {
      const details = await this.describeTable(schema, summary.name);
      if (details) tables.push(details);
    }
    return {
      schemaName: schema,
      capturedAt: this.clock.now().toISOString(),
      tables,
    };
  }

  private async query(sql: string, params: unknown[]): Promise<pg.QueryResult> {
    try {
      return await this.pool.query(sql, params);
    } catch (e) {
      throw mapPgError(e, this.secrets);
    }
  }
}

function latestTimestamp(a: unknown, b: unknown): string | null {
  const dates = [a, b]
    .filter((value): value is Date | string => value !== null && value !== undefined)
    .map((value) => new Date(value as string | Date));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString();
}
