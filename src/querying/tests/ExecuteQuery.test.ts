import { describe, expect, it } from 'vitest';
import { GatewayQueryError } from '../../platform/database/DatabaseGateway.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { ExecuteQuery } from '../application/ExecuteQuery.js';
import { QueryValidator } from '../domain/QueryValidator.js';
import { ResultLimitPolicy } from '../domain/ResultLimitPolicy.js';
import { SlidingWindowRateLimiter } from '../../throttling/domain/SlidingWindowRateLimiter.js';
import { FakeClock, FakeGateway, MemoryAuditLogger } from '../../shared/testing/fakes.js';

function setup(options: { rateLimit?: number; maxRows?: number } = {}) {
  const clock = new FakeClock();
  const auditLog = new MemoryAuditLogger();
  const audit = new AuditService(auditLog, clock);
  const gateway = new FakeGateway();
  const useCase = new ExecuteQuery(
    new OperationGate(new SlidingWindowRateLimiter(clock, options.rateLimit ?? 100, 60_000), audit),
    new QueryValidator(),
    new ResultLimitPolicy(options.maxRows ?? 100),
    gateway,
    audit,
  );
  return { useCase, gateway, auditLog, clock };
}

describe('ExecuteQuery', () => {
  it('executes a valid SELECT and audits it as success', async () => {
    const { useCase, gateway, auditLog } = setup();
    gateway.nextRows = [{ name: 'Jane Smith', email: 'jane@example.com' }];

    const result = await useCase.execute({ sql: 'SELECT name, email FROM users WHERE id = 42', clientId: 'claude' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rows).toHaveLength(1);
      expect(result.value.warning).toBeUndefined();
    }
    expect(auditLog.lastEntry()).toMatchObject({
      tool: 'query_db',
      status: 'success',
      clientId: 'claude',
      rowsReturned: 1,
    });
  });

  it('blocks DROP TABLE, audits the block, and never touches the database', async () => {
    const { useCase, gateway, auditLog } = setup();

    const result = await useCase.execute({ sql: 'DROP TABLE users', clientId: 'claude' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('query_blocked');
    expect(gateway.executedSql).toHaveLength(0);
    expect(auditLog.lastEntry().status).toBe('blocked');
  });

  it('caps an unbounded SELECT and warns when the cap is hit', async () => {
    const { useCase, gateway } = setup({ maxRows: 2 });
    gateway.nextRows = [{ id: 1 }, { id: 2 }];

    const result = await useCase.execute({ sql: 'SELECT * FROM orders', clientId: 'claude' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warning).toMatch(/capped at 2 rows/);
    expect(gateway.executedSql[0]).toMatch(/LIMIT 2/);
  });

  it('rejects requests over the rate limit without consuming a connection', async () => {
    const { useCase, gateway, auditLog } = setup({ rateLimit: 1 });
    await useCase.execute({ sql: 'SELECT 1', clientId: 'claude' });

    const result = await useCase.execute({ sql: 'SELECT 1', clientId: 'claude' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('rate_limited');
    expect(gateway.executedSql).toHaveLength(1);
    expect(auditLog.lastEntry().status).toBe('rate_limited');
  });

  it('maps database errors into the error envelope and audits them', async () => {
    const { useCase, gateway, auditLog } = setup();
    gateway.nextError = new GatewayQueryError('syntax_error', 'syntax error at or near "SELEC"', 1);

    const result = await useCase.execute({ sql: 'SELECT * FROM users WHERE broken', clientId: 'claude' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('syntax_error');
      expect(result.error.details).toMatchObject({ position: 1 });
    }
    expect(auditLog.lastEntry().status).toBe('error');
  });
});
