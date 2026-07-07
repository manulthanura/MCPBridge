/**
 * Test doubles shared across suites. Everything is deterministic: the clock
 * is manually advanced, ids are sequential, the gateway is scriptable.
 */
import { AuditLogger } from '../../audit/application/AuditLogger.js';
import {
  DatabaseGateway,
  GatewayQueryError,
  QueryResultData,
  WriteResultData,
} from '../../platform/database/DatabaseGateway.js';
import { IdGenerator } from '../application/IdGenerator.js';
import { SqlGenerator } from '../../search/application/SqlGenerator.js';
import { AuditEntry } from '../../audit/domain/AuditEntry.js';
import { Clock } from '../domain/Clock.js';

export class FakeClock implements Clock {
  constructor(private currentMs: number = Date.parse('2026-01-01T00:00:00Z')) {}

  now(): Date {
    return new Date(this.currentMs);
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}

export class MemoryAuditLogger implements AuditLogger {
  readonly entries: AuditEntry[] = [];

  async log(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  lastEntry(): AuditEntry {
    const entry = this.entries[this.entries.length - 1];
    if (!entry) throw new Error('no audit entries recorded');
    return entry;
  }
}

export class FakeGateway implements DatabaseGateway {
  executedSql: string[] = [];
  nextRows: Record<string, unknown>[] = [];
  nextRowEstimate: number | null = 1;
  nextError: GatewayQueryError | null = null;
  writeResult: WriteResultData = { rowsAffected: 1, returnedRows: [], durationMs: 5 };

  async executeReadOnly(sql: string): Promise<QueryResultData> {
    this.executedSql.push(sql);
    if (this.nextError) throw this.nextError;
    return {
      rows: this.nextRows,
      fields: this.nextRows.length > 0 ? Object.keys(this.nextRows[0]!) : [],
      rowCount: this.nextRows.length,
      durationMs: 3,
    };
  }

  async executeWrite(sql: string): Promise<WriteResultData> {
    this.executedSql.push(sql);
    if (this.nextError) throw this.nextError;
    return this.writeResult;
  }

  async explain(sql: string, analyze: boolean): Promise<string[]> {
    this.executedSql.push(`EXPLAIN(${analyze}) ${sql}`);
    if (this.nextError) throw this.nextError;
    return ['Seq Scan on users  (cost=0.00..1.05 rows=5 width=100)'];
  }

  async estimateRows(): Promise<number | null> {
    if (this.nextError) throw this.nextError;
    return this.nextRowEstimate;
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}
}

export class SequenceIdGenerator implements IdGenerator {
  private counter = 0;

  nextId(): string {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

export class StubSqlGenerator implements SqlGenerator {
  constructor(public sqlToReturn: string) {}

  async generateSql(): Promise<string> {
    return this.sqlToReturn;
  }
}
