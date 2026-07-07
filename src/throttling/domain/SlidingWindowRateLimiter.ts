/**
 * Throttling context: sliding-window rate limiter. Pure domain logic — the
 * clock is injected, so the window behaviour is fully deterministic in tests.
 *
 * A rejected acquisition consumes no capacity and, crucially, the layers
 * above must reject *before* touching the connection pool (the spec requires
 * that rate-limited requests consume no database connection).
 */
import { Clock } from '../../shared/domain/Clock.js';

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number; limit: number; windowSeconds: number };

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(key: string): RateLimitDecision {
    const nowMs = this.clock.now().getTime();
    const windowStart = nowMs - this.windowMs;

    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (recent.length >= this.limit) {
      const oldest = recent[0]!;
      const retryAfterMs = oldest + this.windowMs - nowMs;
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        limit: this.limit,
        windowSeconds: Math.round(this.windowMs / 1000),
      };
    }

    recent.push(nowMs);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.limit - recent.length };
  }
}
