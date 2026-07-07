/**
 * Application port: storage for write operations awaiting confirmation.
 */
import { PendingWrite } from '../domain/PendingWrite.js';

export interface PendingWriteStore {
  save(write: PendingWrite): Promise<void>;
  get(id: string): Promise<PendingWrite | undefined>;
  delete(id: string): Promise<void>;
  /**
   * Marks every over-age pending write as expired, removes it, and returns
   * the expired writes so the caller can audit-log the expiry.
   */
  sweepExpired(now: Date, ttlMs: number): Promise<PendingWrite[]>;
}
