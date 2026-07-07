/**
 * End-to-end unit test of the guarded write flow:
 * write_db (stage) → confirm_write / reject_write → execution or cancellation.
 */
import { describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { ConfirmWrite } from '../application/ConfirmWrite.js';
import { RejectWrite } from '../application/RejectWrite.js';
import { RequestWrite } from '../application/RequestWrite.js';
import { QueryValidator } from '../../querying/domain/QueryValidator.js';
import { SlidingWindowRateLimiter } from '../../throttling/domain/SlidingWindowRateLimiter.js';
import { RiskAssessor } from '../domain/RiskAssessor.js';
import { InMemoryPendingWriteStore } from '../infrastructure/InMemoryPendingWriteStore.js';
import {
  FakeClock,
  FakeGateway,
  MemoryAuditLogger,
  SequenceIdGenerator,
} from '../../shared/testing/fakes.js';

const TTL = 10 * 60 * 1000;

function setup(options: { readOnlyMode?: boolean } = {}) {
  const clock = new FakeClock();
  const auditLog = new MemoryAuditLogger();
  const audit = new AuditService(auditLog, clock);
  const gateway = new FakeGateway();
  const store = new InMemoryPendingWriteStore();

  const requestWrite = new RequestWrite(
    new OperationGate(new SlidingWindowRateLimiter(clock, 100, 60_000), audit),
    new QueryValidator(),
    gateway,
    new RiskAssessor({ highRiskRowThreshold: 100 }),
    store,
    new SequenceIdGenerator(),
    clock,
    audit,
    { readOnlyMode: options.readOnlyMode ?? false, confirmationTtlMs: TTL },
  );
  const confirmWrite = new ConfirmWrite(store, gateway, clock, audit, TTL);
  const rejectWrite = new RejectWrite(store, clock, audit, TTL);

  return { requestWrite, confirmWrite, rejectWrite, gateway, auditLog, clock, store };
}

describe('guarded write flow', () => {
  it('stages an INSERT without executing it', async () => {
    const { requestWrite, gateway } = setup();

    const result = await requestWrite.execute({
      sql: `INSERT INTO products (name, price) VALUES ('Widget', 9.99)`,
      clientId: 'claude',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operation).toBe('INSERT');
      expect(result.value.targetTable).toBe('products');
      expect(result.value.riskLevel).toBe('low');
      expect(result.value.confirmationId).toBe('id-1');
    }
    // estimateRows ran, but nothing was executed.
    expect(gateway.executedSql).toHaveLength(0);
  });

  it('executes on confirmation and audits the result', async () => {
    const { requestWrite, confirmWrite, gateway, auditLog } = setup();
    const staged = await requestWrite.execute({
      sql: `INSERT INTO products (name) VALUES ('Widget')`,
      clientId: 'claude',
    });
    if (!staged.ok) throw new Error('staging failed');

    const result = await confirmWrite.execute({
      confirmationId: staged.value.confirmationId,
      acknowledgeRisk: false,
      clientId: 'claude',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rowsAffected).toBe(1);
    expect(gateway.executedSql).toContain(`INSERT INTO products (name) VALUES ('Widget')`);
    expect(auditLog.lastEntry().status).toBe('success');
  });

  it('requires double confirmation for a high-risk bulk delete', async () => {
    const { requestWrite, confirmWrite, gateway } = setup();
    gateway.nextRowEstimate = 1247;

    const staged = await requestWrite.execute({
      sql: `DELETE FROM orders WHERE status = 'draft'`,
      clientId: 'claude',
    });
    if (!staged.ok) throw new Error('staging failed');
    expect(staged.value.riskLevel).toBe('high');
    expect(staged.value.requires).toMatch(/risk acknowledgment/);

    const withoutAck = await confirmWrite.execute({
      confirmationId: staged.value.confirmationId,
      acknowledgeRisk: false,
      clientId: 'claude',
    });
    expect(withoutAck.ok).toBe(false);
    if (!withoutAck.ok) expect(withoutAck.error.code).toBe('risk_not_acknowledged');
    expect(gateway.executedSql).toHaveLength(0);

    const withAck = await confirmWrite.execute({
      confirmationId: staged.value.confirmationId,
      acknowledgeRisk: true,
      clientId: 'claude',
    });
    expect(withAck.ok).toBe(true);
    expect(gateway.executedSql).toHaveLength(1);
  });

  it('rejection cancels the write and nothing executes', async () => {
    const { requestWrite, rejectWrite, confirmWrite, gateway } = setup();
    const staged = await requestWrite.execute({
      sql: `DELETE FROM products WHERE id = 1`,
      clientId: 'claude',
    });
    if (!staged.ok) throw new Error('staging failed');

    const rejected = await rejectWrite.execute({
      confirmationId: staged.value.confirmationId,
      clientId: 'claude',
    });
    expect(rejected.ok).toBe(true);
    expect(gateway.executedSql).toHaveLength(0);

    // A later confirm of the same id must fail.
    const lateConfirm = await confirmWrite.execute({
      confirmationId: staged.value.confirmationId,
      acknowledgeRisk: true,
      clientId: 'claude',
    });
    expect(lateConfirm.ok).toBe(false);
  });

  it('expires unconfirmed writes after the timeout', async () => {
    const { requestWrite, confirmWrite, clock, gateway } = setup();
    const staged = await requestWrite.execute({
      sql: `UPDATE products SET price = 1 WHERE id = 1`,
      clientId: 'claude',
    });
    if (!staged.ok) throw new Error('staging failed');

    clock.advance(TTL + 60_000);

    const result = await confirmWrite.execute({
      confirmationId: staged.value.confirmationId,
      acknowledgeRisk: true,
      clientId: 'claude',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('pending_write_not_found');
    expect(gateway.executedSql).toHaveLength(0);
  });

  it('blocks write_db entirely in read-only mode', async () => {
    const { requestWrite, auditLog } = setup({ readOnlyMode: true });

    const result = await requestWrite.execute({
      sql: `INSERT INTO products (name) VALUES ('x')`,
      clientId: 'claude',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toMatch(/read-only mode/);
    expect(auditLog.lastEntry().status).toBe('blocked');
  });
});
