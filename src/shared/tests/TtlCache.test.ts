import { describe, expect, it } from 'vitest';
import { TtlCache } from '../domain/TtlCache.js';
import { FakeClock } from '../testing/fakes.js';

describe('TtlCache', () => {
  it('serves cached values within the TTL and reloads after expiry', async () => {
    const clock = new FakeClock();
    const cache = new TtlCache<string>(clock, 5 * 60 * 1000);
    let loads = 0;
    const load = async () => {
      loads += 1;
      return `value-${loads}`;
    };

    expect(await cache.getOrLoad('k', load)).toBe('value-1');
    clock.advance(4 * 60 * 1000);
    expect(await cache.getOrLoad('k', load)).toBe('value-1');
    expect(loads).toBe(1);

    clock.advance(2 * 60 * 1000); // past the 5-minute TTL
    expect(await cache.getOrLoad('k', load)).toBe('value-2');
    expect(loads).toBe(2);
  });

  it('invalidateAll drops every entry', async () => {
    const clock = new FakeClock();
    const cache = new TtlCache<number>(clock, 60_000);
    cache.set('a', 1);
    cache.invalidateAll();
    expect(cache.get('a')).toBeUndefined();
  });
});
