/**
 * Application service: stamps and persists audit entries. Audit failures are
 * reported to stderr but never break request serving (reliability spec R-07).
 */
import { AuditEntry } from '../domain/AuditEntry.js';
import { Clock } from '../../shared/domain/Clock.js';
import { AuditLogger } from './AuditLogger.js';

export class AuditService {
  constructor(
    private readonly logger: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async record(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
    try {
      await this.logger.log({
        timestamp: this.clock.now().toISOString(),
        ...entry,
      });
    } catch (e) {
      // stdout carries the MCP protocol; diagnostics go to stderr.
      console.error('[mcpbridge] audit logging failed:', e);
    }
  }
}
