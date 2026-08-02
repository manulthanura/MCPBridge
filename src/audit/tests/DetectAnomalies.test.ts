import { describe, expect, it } from 'vitest';
import { AuditService } from '../application/AuditService.js';
import { DetectAnomalies } from '../application/DetectAnomalies.js';
import { AnomalyDetector } from '../domain/AnomalyDetector.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { SlidingWindowRateLimiter } from '../../throttling/domain/SlidingWindowRateLimiter.js';
import { FakeAuditReader, FakeClock, MemoryAuditLogger } from '../../shared/testing/fakes.js';

function setup(options: { rateLimit?: number } = {}) {
  const clock = new FakeClock();
  const auditLog = new MemoryAuditLogger();
  const audit = new AuditService(auditLog, clock);
  const reader = new FakeAuditReader();
  const useCase = new DetectAnomalies(
    new OperationGate(new SlidingWindowRateLimiter(clock, options.rateLimit ?? 100, 60_000), audit),
    reader,
    new AnomalyDetector({ sequentialScanThreshold: 3 }),
    clock,
    audit,
  );
  return { useCase, reader, auditLog, clock };
}

describe('DetectAnomalies', () => {
  it('analyzes only entries within the lookback window and audits the run', async () => {
    const { useCase, reader, auditLog, clock } = setup();
    reader.entries = [
      { timestamp: clock.now().toISOString(), tool: 'query_db', clientId: 'claude', status: 'success', sql: 'SELECT * FROM users WHERE id = 1' },
    ];

    const result = await useCase.execute({ lookbackMinutes: 60, clientId: 'claude' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entriesAnalyzed).toBe(1);
      expect(result.value.windowMinutes).toBe(60);
    }
    expect(auditLog.lastEntry()).toMatchObject({ tool: 'detect_anomalies', status: 'success' });
  });

  it('surfaces flagged patterns from the detector', async () => {
    const { useCase, reader, clock } = setup();
    reader.entries = Array.from({ length: 3 }, (_, i) => ({
      timestamp: clock.now().toISOString(),
      tool: 'query_db',
      clientId: 'claude',
      status: 'success' as const,
      sql: `SELECT * FROM users WHERE id = ${i + 1}`,
    }));

    const result = await useCase.execute({ clientId: 'claude' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.anomalies).toContainEqual(
        expect.objectContaining({ pattern: 'sequential scanning of all user IDs' }),
      );
    }
  });

  it('rejects requests over the rate limit before reading the audit trail', async () => {
    const { useCase, reader, auditLog } = setup({ rateLimit: 1 });
    await useCase.execute({ clientId: 'claude' });

    const result = await useCase.execute({ clientId: 'claude' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('rate_limited');
    expect(auditLog.lastEntry().status).toBe('rate_limited');
  });

  it('reports a reader failure as an internal error without throwing', async () => {
    const { useCase, reader } = setup();
    reader.readSince = async () => {
      throw new Error('disk unavailable');
    };

    const result = await useCase.execute({ clientId: 'claude' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal_error');
  });
});
