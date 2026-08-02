import { describe, expect, it } from 'vitest';
import { AnomalyDetector } from '../domain/AnomalyDetector.js';
import { AuditEntry } from '../domain/AuditEntry.js';

const BASE_TIME = Date.parse('2026-01-01T12:00:00Z');

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date(BASE_TIME).toISOString(),
    tool: 'query_db',
    clientId: 'claude',
    status: 'success',
    ...overrides,
  };
}

describe('AnomalyDetector', () => {
  it('reports nothing for a handful of unremarkable queries', () => {
    const detector = new AnomalyDetector();
    const entries = [
      entry({ sql: 'SELECT * FROM orders WHERE id = 1' }),
      entry({ sql: 'SELECT * FROM users WHERE id = 2' }),
    ];

    expect(detector.detect(entries)).toEqual([]);
  });

  it('flags a burst of 50+ queries against the same table within one minute', () => {
    const detector = new AnomalyDetector({ sameTableThreshold: 5 });
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sql: 'SELECT * FROM orders WHERE status = $1',
        timestamp: new Date(BASE_TIME + i * 1_000).toISOString(),
      }),
    );

    const anomalies = detector.detect(entries);
    expect(anomalies).toContainEqual(
      expect.objectContaining({ pattern: '50+ queries to same table in 1 min', level: 'warning' }),
    );
  });

  it('does not flag a burst spread outside the window', () => {
    const detector = new AnomalyDetector({ sameTableThreshold: 5, sameTableWindowMs: 60_000 });
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sql: 'SELECT * FROM orders WHERE status = $1',
        timestamp: new Date(BASE_TIME + i * 30_000).toISOString(), // 30s apart, > 60s window overall
      }),
    );

    const anomalies = detector.detect(entries);
    expect(anomalies.find((a) => a.pattern.includes('same table'))).toBeUndefined();
  });

  it('flags sequential scanning of ids as high risk', () => {
    const detector = new AnomalyDetector({ sequentialScanThreshold: 5 });
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({ sql: `SELECT * FROM users WHERE id = ${i + 1}` }),
    );

    const anomalies = detector.detect(entries);
    expect(anomalies).toContainEqual(
      expect.objectContaining({ pattern: 'sequential scanning of all user IDs', level: 'high' }),
    );
  });

  it('does not flag scattered, non-consecutive id lookups', () => {
    const detector = new AnomalyDetector({ sequentialScanThreshold: 5 });
    const entries = [10, 55, 3, 900, 42].map((id) => entry({ sql: `SELECT * FROM users WHERE id = ${id}` }));

    const anomalies = detector.detect(entries);
    expect(anomalies.find((a) => a.pattern.includes('sequential'))).toBeUndefined();
  });

  it('flags activity during unusual access hours as info', () => {
    const detector = new AnomalyDetector({ unusualHourRange: [0, 5] });
    const entries = [entry({ sql: 'SELECT 1', timestamp: '2026-01-01T03:00:00Z' })];

    const anomalies = detector.detect(entries);
    expect(anomalies).toContainEqual(
      expect.objectContaining({ pattern: 'unusual access time (3 AM)', level: 'info' }),
    );
  });

  it('does not flag activity within normal business hours', () => {
    const detector = new AnomalyDetector({ unusualHourRange: [0, 5] });
    const entries = [entry({ sql: 'SELECT 1', timestamp: '2026-01-01T14:00:00Z' })];

    expect(detector.detect(entries)).toEqual([]);
  });

  it('ignores entries without SQL (e.g. rate-limited rejections)', () => {
    const detector = new AnomalyDetector({ sameTableThreshold: 2 });
    const entries = [entry({ sql: undefined, status: 'rate_limited' }), entry({ sql: undefined, status: 'rate_limited' })];

    expect(detector.detect(entries)).toEqual([]);
  });
});
