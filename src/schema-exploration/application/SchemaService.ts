/**
 * Application service: schema access with TTL caching in front of the
 * introspector. Schema queries hit several system catalogs, so cache hits
 * matter (performance spec P-02/P-03); the TTL bounds staleness (R-06).
 */
import { TtlCache } from '../../shared/domain/TtlCache.js';
import {
  Relationship,
  SchemaSnapshot,
  TableDetails,
  TableStatistics,
  TableSummary,
} from '../domain/types.js';
import { Clock } from '../../shared/domain/Clock.js';
import { SchemaIntrospector } from './SchemaIntrospector.js';

export class SchemaService {
  private readonly cache: TtlCache<unknown>;

  constructor(
    private readonly introspector: SchemaIntrospector,
    clock: Clock,
    ttlMs: number,
  ) {
    this.cache = new TtlCache<unknown>(clock, ttlMs);
  }

  listTables(schema: string): Promise<TableSummary[]> {
    return this.cached(`tables:${schema}`, () => this.introspector.listTables(schema));
  }

  describeTable(schema: string, table: string): Promise<TableDetails | null> {
    return this.cached(`table:${schema}.${table}`, () =>
      this.introspector.describeTable(schema, table),
    );
  }

  getRelationships(schema: string, table: string): Promise<Relationship[]> {
    return this.cached(`relations:${schema}.${table}`, () =>
      this.introspector.getRelationships(schema, table),
    );
  }

  getTableStatistics(schema: string, table: string): Promise<TableStatistics | null> {
    return this.cached(`stats:${schema}.${table}`, () =>
      this.introspector.getTableStatistics(schema, table),
    );
  }

  /** Sample rows are live data, never cached. */
  getSampleRows(schema: string, table: string, limit: number): Promise<Record<string, unknown>[]> {
    return this.introspector.getSampleRows(schema, table, limit);
  }

  getSchemaSnapshot(schema: string): Promise<SchemaSnapshot> {
    return this.cached(`snapshot:${schema}`, () => this.introspector.getSchemaSnapshot(schema));
  }

  /**
   * Compact plain-text schema description used as LLM context for natural
   * language → SQL generation.
   */
  async getSchemaContext(schema: string): Promise<string> {
    const snapshot = await this.getSchemaSnapshot(schema);
    const lines: string[] = [`PostgreSQL schema "${snapshot.schemaName}":`];
    for (const table of snapshot.tables) {
      const cols = table.columns
        .map((c) => `${c.name} ${c.dataType}${c.isPrimaryKey ? ' PK' : ''}${c.nullable ? '' : ' NOT NULL'}`)
        .join(', ');
      lines.push(`- ${table.name} (~${table.estimatedRows} rows): ${cols}`);
      for (const fk of table.foreignKeys) {
        lines.push(`  FK: ${table.name}.${fk.column} -> ${fk.referencesTable}.${fk.referencesColumn}`);
      }
    }
    return lines.join('\n');
  }

  invalidate(): void {
    this.cache.invalidateAll();
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    // Single heterogeneous cache; keys are namespaced by operation, so each
    // key is only ever written with one value type.
    return (this.cache as TtlCache<T>).getOrLoad(key, load);
  }
}
