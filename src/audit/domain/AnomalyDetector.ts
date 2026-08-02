/**
 * Audit context: heuristic pattern detection over the audit trail (spec:
 * "Track query patterns for anomaly detection"). Pure and read-only — it
 * only ever looks at already-logged AuditEntry records, never the database.
 */
import { stripCommentsAndStrings } from '../../querying/domain/sql-text.js';
import { Anomaly } from './Anomaly.js';
import { AuditEntry } from './AuditEntry.js';

export interface AnomalyDetectorOptions {
  /** Same-table request count within sameTableWindowMs that trips a "warning". */
  sameTableThreshold?: number;
  /** Sliding window used for the same-table burst check. */
  sameTableWindowMs?: number;
  /** Distinct consecutive literal ids probed against one table that trips a "high" alert. */
  sequentialScanThreshold?: number;
  /** UTC hour range [start, end) treated as an unusual access time. */
  unusualHourRange?: readonly [number, number];
}

const DEFAULTS: Required<AnomalyDetectorOptions> = {
  sameTableThreshold: 50,
  sameTableWindowMs: 60_000,
  sequentialScanThreshold: 10,
  unusualHourRange: [0, 5],
};

const TABLE_PATTERN =
  /\b(?:from|into|update|join)\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)/i;
const ID_EQUALITY_PATTERN = /\bid\s*=\s*'?(\d+)'?/gi;

export class AnomalyDetector {
  private readonly options: Required<AnomalyDetectorOptions>;

  constructor(options: AnomalyDetectorOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  detect(entries: readonly AuditEntry[]): Anomaly[] {
    return [
      ...this.detectSameTableBursts(entries),
      ...this.detectSequentialIdScans(entries),
      ...this.detectUnusualAccessTimes(entries),
    ];
  }

  private detectSameTableBursts(entries: readonly AuditEntry[]): Anomaly[] {
    const timestampsByTable = new Map<string, number[]>();
    for (const entry of entries) {
      const table = firstTable(entry.sql);
      const ms = Date.parse(entry.timestamp);
      if (!table || Number.isNaN(ms)) continue;
      const list = timestampsByTable.get(table) ?? [];
      list.push(ms);
      timestampsByTable.set(table, list);
    }

    const anomalies: Anomaly[] = [];
    for (const [table, timestamps] of timestampsByTable) {
      timestamps.sort((a, b) => a - b);
      const burst = maxCountWithinWindow(timestamps, this.options.sameTableWindowMs);
      if (burst >= this.options.sameTableThreshold) {
        anomalies.push({
          pattern: '50+ queries to same table in 1 min',
          level: 'warning',
          detail: `${burst} operations against "${table}" within ${this.options.sameTableWindowMs / 1000}s`,
        });
      }
    }
    return anomalies;
  }

  private detectSequentialIdScans(entries: readonly AuditEntry[]): Anomaly[] {
    const idsByTable = new Map<string, Set<number>>();
    for (const entry of entries) {
      const table = firstTable(entry.sql);
      if (!table || !entry.sql) continue;
      const ids = idsByTable.get(table) ?? new Set<number>();
      for (const match of entry.sql.matchAll(ID_EQUALITY_PATTERN)) {
        ids.add(Number(match[1]));
      }
      idsByTable.set(table, ids);
    }

    const anomalies: Anomaly[] = [];
    for (const [table, ids] of idsByTable) {
      const longestRun = longestConsecutiveRun(ids);
      if (longestRun >= this.options.sequentialScanThreshold) {
        anomalies.push({
          pattern: 'sequential scanning of all user IDs',
          level: 'high',
          detail: `${longestRun} consecutive ids probed against "${table}"`,
        });
      }
    }
    return anomalies;
  }

  private detectUnusualAccessTimes(entries: readonly AuditEntry[]): Anomaly[] {
    const [start, end] = this.options.unusualHourRange;
    const offenders = entries.filter((entry) => {
      const hour = new Date(entry.timestamp).getUTCHours();
      return hour >= start && hour < end;
    });
    if (offenders.length === 0) return [];
    return [
      {
        pattern: 'unusual access time (3 AM)',
        level: 'info',
        detail: `${offenders.length} operation(s) between ${pad(start)}:00 and ${pad(end)}:00 UTC`,
      },
    ];
  }
}

function firstTable(sql: string | undefined): string | null {
  if (!sql) return null;
  const match = TABLE_PATTERN.exec(stripCommentsAndStrings(sql));
  return match?.[1]?.toLowerCase() ?? null;
}

/** Largest number of timestamps that fall within any windowMs-wide slice. */
function maxCountWithinWindow(sortedTimestamps: number[], windowMs: number): number {
  let best = 0;
  let start = 0;
  for (let end = 0; end < sortedTimestamps.length; end++) {
    while (sortedTimestamps[end]! - sortedTimestamps[start]! > windowMs) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

function longestConsecutiveRun(ids: Set<number>): number {
  let best = 0;
  for (const id of ids) {
    if (ids.has(id - 1)) continue; // not the start of a run
    let length = 1;
    let cursor = id;
    while (ids.has(cursor + 1)) {
      cursor++;
      length++;
    }
    best = Math.max(best, length);
  }
  return best;
}

function pad(hour: number): string {
  return hour.toString().padStart(2, '0');
}
