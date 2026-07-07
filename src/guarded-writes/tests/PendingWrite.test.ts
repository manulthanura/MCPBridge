import { describe, expect, it } from 'vitest';
import { PendingWrite } from '../domain/PendingWrite.js';
import { FakeClock } from '../../shared/testing/fakes.js';

const TTL = 10 * 60 * 1000;

function makeWrite(clock: FakeClock, risk: 'low' | 'high' = 'low'): PendingWrite {
  return new PendingWrite({
    id: 'uuid-xxx',
    sql: `DELETE FROM orders WHERE status = 'draft'`,
    kind: 'delete',
    targetTable: 'orders',
    estimatedRows: risk === 'high' ? 1247 : 1,
    risk,
    preview: 'Will delete rows',
    createdAt: clock.now(),
  });
}

describe('PendingWrite', () => {
  it('confirms a low-risk write within the window', () => {
    const clock = new FakeClock();
    const write = makeWrite(clock);
    const outcome = write.confirm(clock.now(), TTL, false);
    expect(outcome.ok).toBe(true);
    expect(write.status).toBe('confirmed');
  });

  it('requires risk acknowledgment for high-risk writes (double confirmation)', () => {
    const clock = new FakeClock();
    const write = makeWrite(clock, 'high');

    const withoutAck = write.confirm(clock.now(), TTL, false);
    expect(withoutAck.ok).toBe(false);
    if (!withoutAck.ok) expect(withoutAck.code).toBe('risk_not_acknowledged');
    expect(write.status).toBe('pending');

    const withAck = write.confirm(clock.now(), TTL, true);
    expect(withAck.ok).toBe(true);
    expect(write.status).toBe('confirmed');
  });

  it('expires after the confirmation timeout', () => {
    const clock = new FakeClock();
    const write = makeWrite(clock);
    clock.advance(TTL + 1);

    const outcome = write.confirm(clock.now(), TTL, true);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('expired');
    expect(write.status).toBe('expired');
  });

  it('cannot be confirmed twice', () => {
    const clock = new FakeClock();
    const write = makeWrite(clock);
    write.confirm(clock.now(), TTL, false);

    const second = write.confirm(clock.now(), TTL, false);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('already_resolved');
  });

  it('rejects a pending write without touching data', () => {
    const clock = new FakeClock();
    const write = makeWrite(clock);
    const outcome = write.reject(clock.now(), TTL);
    expect(outcome.ok).toBe(true);
    expect(write.status).toBe('rejected');
  });
});
