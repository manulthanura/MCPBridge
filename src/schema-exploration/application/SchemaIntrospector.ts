/**
 * Application port: schema intelligence. Implemented against PostgreSQL
 * system catalogs in the infrastructure layer.
 */
import {
  Relationship,
  SchemaSnapshot,
  TableDetails,
  TableStatistics,
  TableSummary,
} from '../domain/types.js';

export interface SchemaIntrospector {
  listTables(schema: string): Promise<TableSummary[]>;
  /** Null when the table does not exist. */
  describeTable(schema: string, table: string): Promise<TableDetails | null>;
  getRelationships(schema: string, table: string): Promise<Relationship[]>;
  getTableStatistics(schema: string, table: string): Promise<TableStatistics | null>;
  getSampleRows(schema: string, table: string, limit: number): Promise<Record<string, unknown>[]>;
  getSchemaSnapshot(schema: string): Promise<SchemaSnapshot>;
}
