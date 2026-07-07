/**
 * Infrastructure: in-memory pending-write store. Pending writes are
 * intentionally ephemeral — a server restart cancels them, which is the safe
 * failure mode for unconfirmed mutations.
 */
import { PendingWriteStore } from '../application/PendingWriteStore.js';
import { PendingWrite } from '../domain/PendingWrite.js';

export class InMemoryPendingWriteStore implements PendingWriteStore {
  private readonly writes = new Map<string, PendingWrite>();

  async save(write: PendingWrite): Promise<void> {
    this.writes.set(write.id, write);
  }

  async get(id: string): Promise<PendingWrite | undefined> {
    return this.writes.get(id);
  }

  async delete(id: string): Promise<void> {
    this.writes.delete(id);
  }

  async sweepExpired(now: Date, ttlMs: number): Promise<PendingWrite[]> {
    const expired: PendingWrite[] = [];
    for (const [id, write] of this.writes) {
      if (write.expireIfDue(now, ttlMs)) {
        expired.push(write);
        this.writes.delete(id);
      }
    }
    return expired;
  }
}
