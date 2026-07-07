/**
 * Schema context: TTL cache used for schema snapshots and table metadata.
 * Schema introspection is expensive (multiple catalog queries) but schemas
 * change rarely — the project spec calls for a 5-minute TTL.
 */
import { Clock } from './Clock.js';

interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.clock.now().getTime() >= entry.expiresAtMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, {
      value,
      expiresAtMs: this.clock.now().getTime() + this.ttlMs,
    });
  }

  /** Drops everything — called when a schema change is detected. */
  invalidateAll(): void {
    this.entries.clear();
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await load();
    this.set(key, value);
    return value;
  }
}
