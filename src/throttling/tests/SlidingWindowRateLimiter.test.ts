import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../domain/SlidingWindowRateLimiter.js';
import { FakeClock } from '../../shared/testing/fakes.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit and rejects the next request', () => {
    const clock = new FakeClock();
    const limiter = new SlidingWindowRateLimiter(clock, 3, 60_000);

    expect(limiter.tryAcquire('client').allowed).toBe(true);
    expect(limiter.tryAcquire('client').allowed).toBe(true);
    expect(limiter.tryAcquire('client').allowed).toBe(true);

    const rejected = limiter.tryAcquire('client');
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) {
      expect(rejected.limit).toBe(3);
      expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
      expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('frees capacity as the window slides', () => {
    const clock = new FakeClock();
    const limiter = new SlidingWindowRateLimiter(clock, 2, 60_000);

    limiter.tryAcquire('client');
    clock.advance(30_000);
    limiter.tryAcquire('client');
    expect(limiter.tryAcquire('client').allowed).toBe(false);

    clock.advance(31_000); // first hit falls out of the window
    expect(limiter.tryAcquire('client').allowed).toBe(true);
  });

  it('tracks clients independently', () => {
    const clock = new FakeClock();
    const limiter = new SlidingWindowRateLimiter(clock, 1, 60_000);

    expect(limiter.tryAcquire('a').allowed).toBe(true);
    expect(limiter.tryAcquire('a').allowed).toBe(false);
    expect(limiter.tryAcquire('b').allowed).toBe(true);
  });
});
