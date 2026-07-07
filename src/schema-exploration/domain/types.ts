/**
 * Schema context: the ubiquitous language for describing database structure.
 * These types are what every layer above the introspector speaks in —
 * infrastructure maps PostgreSQL catalogs into them.
 */

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface ForeignKeyInfo {
  constraintName: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface IndexInfo {
  name: string;
  definition: string;
  isUnique: boolean;
  isPrimary: boolean;
}

export interface TableSummary {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'materialized view' | 'foreign table';
  estimatedRows: number;
  description: string | null;
}

export interface TableDetails extends TableSummary {
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
}

export type RelationshipDirection = 'outgoing' | 'incoming';

export interface Relationship {
  /** 'outgoing': this table references another; 'incoming': another table references this one. */
  direction: RelationshipDirection;
  fromTable: string;
  toTable: string;
  viaColumn: string;
  /** many-to-one for outgoing FKs, one-to-many for incoming. */
  cardinality: 'many-to-one' | 'one-to-many' | 'one-to-one';
}

export interface TableStatistics {
  schema: string;
  table: string;
  estimatedRows: number;
  totalSizeBytes: number;
  indexSizeBytes: number;
  lastVacuum: string | null;
  lastAnalyze: string | null;
  columnStats: ColumnStatistics[];
}

export interface ColumnStatistics {
  column: string;
  nullFraction: number | null;
  distinctValues: number | null;
}

export interface SchemaSnapshot {
  schemaName: string;
  capturedAt: string;
  tables: TableDetails[];
}
