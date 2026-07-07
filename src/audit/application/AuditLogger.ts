/**
 * Application port: audit trail sink. The JSONL file implementation lives in
 * infrastructure; tests use an in-memory fake.
 */
import { AuditEntry } from '../domain/AuditEntry.js';

export interface AuditLogger {
  log(entry: AuditEntry): Promise<void>;
}
