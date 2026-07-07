/**
 * Audit context: the shape of one audit-trail record. Every tool invocation
 * — successful, failed, blocked or rate-limited — produces exactly one entry.
 */

export type AuditStatus = 'success' | 'error' | 'blocked' | 'rate_limited';

export interface AuditEntry {
  /** ISO 8601 timestamp of when the operation completed. */
  timestamp: string;
  /** MCP tool that handled the request (query_db, write_db, ...). */
  tool: string;
  /** The SQL involved, when the operation carried SQL. */
  sql?: string;
  /** Wall-clock duration of the database work, in milliseconds. */
  executionTimeMs?: number;
  /** Number of rows returned (reads) or affected (writes). */
  rowsReturned?: number;
  /** Identifier of the connected AI assistant/client. */
  clientId: string;
  status: AuditStatus;
  /** Human-readable detail: error reason, block reason, confirmation id, ... */
  detail?: string;
}
