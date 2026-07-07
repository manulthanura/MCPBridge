/**
 * Use case: confirm_write — resolve a pending write and execute it inside a
 * transaction. The PendingWrite aggregate owns the transition rules (expiry,
 * double confirmation for high risk); this use case orchestrates.
 */
import { Clock } from '../../shared/domain/Clock.js';
import { DatabaseGateway, WriteResultData } from '../../platform/database/DatabaseGateway.js';
import { PendingWriteStore } from './PendingWriteStore.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { err, fromGatewayError, ok, UseCaseResult } from '../../shared/application/result.js';

export interface ConfirmWriteOutput extends WriteResultData {
  confirmationId: string;
  targetTable: string;
}

const TOOL = 'confirm_write';

export class ConfirmWrite {
  constructor(
    private readonly store: PendingWriteStore,
    private readonly gateway: DatabaseGateway,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly confirmationTtlMs: number,
  ) {}

  async execute(input: {
    confirmationId: string;
    acknowledgeRisk: boolean;
    clientId: string;
  }): Promise<UseCaseResult<ConfirmWriteOutput>> {
    await this.expireDueWrites(input.clientId);

    const pending = await this.store.get(input.confirmationId);
    if (!pending) {
      return err({
        code: 'pending_write_not_found',
        reason: `No pending write operation with confirmation_id "${input.confirmationId}"`,
        hint: 'It may have expired (pending writes are cancelled after the timeout) or was already resolved',
      });
    }

    const outcome = pending.confirm(this.clock.now(), this.confirmationTtlMs, input.acknowledgeRisk);
    if (!outcome.ok) {
      if (outcome.code === 'expired') await this.store.delete(pending.id);
      await this.audit.record({
        tool: TOOL,
        sql: pending.sql,
        clientId: input.clientId,
        status: 'blocked',
        detail: `${outcome.code}: ${outcome.reason}`,
      });
      return err({ code: outcome.code, reason: outcome.reason });
    }

    try {
      const result = await this.gateway.executeWrite(pending.sql);
      await this.store.delete(pending.id);
      await this.audit.record({
        tool: TOOL,
        sql: pending.sql,
        clientId: input.clientId,
        status: 'success',
        executionTimeMs: result.durationMs,
        rowsReturned: result.rowsAffected,
        detail: `confirmed ${pending.id}`,
      });
      return ok({
        ...result,
        confirmationId: pending.id,
        targetTable: pending.targetTable,
      });
    } catch (e) {
      await this.store.delete(pending.id);
      const error = fromGatewayError(e);
      await this.audit.record({
        tool: TOOL,
        sql: pending.sql,
        clientId: input.clientId,
        status: 'error',
        detail: error.reason,
      });
      return err(error);
    }
  }

  private async expireDueWrites(clientId: string): Promise<void> {
    const expired = await this.store.sweepExpired(this.clock.now(), this.confirmationTtlMs);
    for (const write of expired) {
      await this.audit.record({
        tool: TOOL,
        sql: write.sql,
        clientId,
        status: 'blocked',
        detail: `pending write ${write.id} expired without confirmation`,
      });
    }
  }
}
