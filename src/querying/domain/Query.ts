/**
 * Querying context: value objects describing a classified SQL statement.
 */

export type StatementKind =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'ddl'
  | 'explain'
  | 'show'
  | 'unknown';

export type WriteKind = Extract<StatementKind, 'insert' | 'update' | 'delete'>;

export interface ClassifiedQuery {
  /** The SQL exactly as it will be sent to the database. */
  readonly sql: string;
  /** The statement text with comments/strings blanked, for further analysis. */
  readonly stripped: string;
  readonly kind: StatementKind;
  readonly isReadOnly: boolean;
}

export const READ_ONLY_KINDS: ReadonlySet<StatementKind> = new Set([
  'select',
  'explain',
  'show',
]);

export const WRITE_KINDS: ReadonlySet<StatementKind> = new Set([
  'insert',
  'update',
  'delete',
]);
