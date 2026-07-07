/**
 * Application port: what the use cases need from a database. Implemented by
 * the PostgreSQL adapter in the infrastructure layer.
 */

export interface QueryResultData {
  rows: Record<string, unknown>[];
  fields: string[];
  rowCount: number;
  durationMs: number;
}

export interface WriteResultData {
  rowsAffected: number;
  /** Rows returned by a RETURNING clause, if any. */
  returnedRows: Record<string, unknown>[];
  durationMs: number;
}

export type GatewayErrorCode =
  | 'syntax_error'
  | 'query_timeout'
  | 'connection_error'
  | 'permission_denied'
  | 'db_error';

/**
 * The only error shape the gateway may throw for query failures. Adapters
 * are responsible for redacting credentials before constructing one.
 */
export class GatewayQueryError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    /** 1-based character position of a syntax error, when PostgreSQL reports one. */
    readonly position?: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'GatewayQueryError';
  }
}

export interface DatabaseGateway {
  /**
   * Executes SQL inside a READ ONLY transaction — defence in depth beneath
   * the domain-level validator.
   */
  executeReadOnly(sql: string): Promise<QueryResultData>;

  /** Executes a write statement inside a transaction (commit on success). */
  executeWrite(sql: string): Promise<WriteResultData>;

  /**
   * Returns the EXPLAIN plan as text lines. `analyze` must only ever be true
   * for read-only statements (EXPLAIN ANALYZE executes the statement).
   */
  explain(sql: string, analyze: boolean): Promise<string[]>;

  /**
   * Estimated rows a statement touches, from the planner (EXPLAIN without
   * ANALYZE — never executes). Null when no estimate is available.
   */
  estimateRows(sql: string): Promise<number | null>;

  /** Liveness check used at startup and by health reporting. */
  ping(): Promise<void>;

  close(): Promise<void>;
}
