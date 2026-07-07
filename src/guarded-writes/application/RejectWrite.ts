/**
 * Use case: reject_write — cancel a pending write. Nothing touches the
 * database; the rejection is recorded in the audit trail.
 */
import { Clock } from '../../shared/domain/Clock.js';
import { PendingWriteStore } from './PendingWriteStore.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { err, ok, UseCaseResult } from '../../shared/application/result.js';

export interface RejectWriteOutput {
  confirmationId: string;
  targetTable: string;
  status: 'rejected';
}

const TOOL = 'reject_write';

export class RejectWrite {
  constructor(
    private readonly store: PendingWriteStore,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly confirmationTtlMs: number,
  ) {}

  async execute(input: {
    confirmationId: string;
    clientId: string;
  }): Promise<UseCaseResult<RejectWriteOutput>> {
    const pending = await this.store.get(input.confirmationId);
    if (!pending) {
      return err({
        code: 'pending_write_not_found',
        reason: `No pending write operation with confirmation_id "${input.confirmationId}"`,
        hint: 'It may have already expired or been resolved',
      });
    }

    const outcome = pending.reject(this.clock.now(), this.confirmationTtlMs);
    await this.store.delete(pending.id);

    if (!outcome.ok) {
      await this.audit.record({
        tool: TOOL,
        sql: pending.sql,
        clientId: input.clientId,
        status: 'blocked',
        detail: `${outcome.code}: ${outcome.reason}`,
      });
      return err({ code: outcome.code, reason: outcome.reason });
    }

    await this.audit.record({
      tool: TOOL,
      sql: pending.sql,
      clientId: input.clientId,
      status: 'success',
      detail: `rejected ${pending.id}; no data was modified`,
    });

    return ok({
      confirmationId: pending.id,
      targetTable: pending.targetTable,
      status: 'rejected',
    });
  }
}
