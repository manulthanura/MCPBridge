/**
 * Use case: write_db — stage a write for confirmation. Nothing is executed
 * here: the statement is validated, its impact estimated via the planner,
 * risk-assessed, and parked as a PendingWrite that expires if unconfirmed.
 */
import { WriteKind } from '../../querying/domain/Query.js';
import { QueryValidator } from '../../querying/domain/QueryValidator.js';
import { Clock } from '../../shared/domain/Clock.js';
import { PendingWrite } from '../domain/PendingWrite.js';
import { RiskAssessor, RiskLevel } from '../domain/RiskAssessor.js';
import { extractTargetTable } from '../domain/target-table.js';
import { DatabaseGateway } from '../../platform/database/DatabaseGateway.js';
import { IdGenerator } from '../../shared/application/IdGenerator.js';
import { PendingWriteStore } from './PendingWriteStore.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { err, fromGatewayError, ok, UseCaseResult } from '../../shared/application/result.js';

export interface RequestWriteOutput {
  confirmationId: string;
  operation: Uppercase<WriteKind>;
  targetTable: string;
  estimatedRows: number | null;
  riskLevel: RiskLevel;
  riskReasons: string[];
  preview: string;
  expiresInSeconds: number;
  requires: string;
}

const TOOL = 'write_db';

export class RequestWrite {
  constructor(
    private readonly gate: OperationGate,
    private readonly validator: QueryValidator,
    private readonly gateway: DatabaseGateway,
    private readonly riskAssessor: RiskAssessor,
    private readonly store: PendingWriteStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly options: { readOnlyMode: boolean; confirmationTtlMs: number },
  ) {}

  async execute(input: { sql: string; clientId: string }): Promise<UseCaseResult<RequestWriteOutput>> {
    if (this.options.readOnlyMode) {
      await this.audit.record({
        tool: TOOL,
        sql: input.sql,
        clientId: input.clientId,
        status: 'blocked',
        detail: 'server is in read-only mode',
      });
      return err({
        code: 'query_blocked',
        reason: 'This MCPBridge server is configured in read-only mode; write operations are disabled',
        hint: 'Set MCPBRIDGE_MODE=read-write to enable guarded writes',
      });
    }

    const gate = await this.gate.pass(TOOL, input.clientId);
    if (!gate.ok) return err(gate.error);

    const validation = this.validator.validateWrite(input.sql);
    if (!validation.ok) {
      await this.audit.record({
        tool: TOOL,
        sql: input.sql,
        clientId: input.clientId,
        status: 'blocked',
        detail: validation.reason,
      });
      return err({ code: validation.error, reason: validation.reason, hint: validation.hint });
    }

    const { query } = validation;
    const kind = query.kind as WriteKind;
    const targetTable = extractTargetTable(query.sql, kind);

    let estimatedRows: number | null = null;
    try {
      estimatedRows = await this.gateway.estimateRows(query.sql);
    } catch (e) {
      // A statement the planner rejects outright is a real error, not a
      // missing estimate.
      const error = fromGatewayError(e);
      await this.audit.record({
        tool: TOOL,
        sql: query.sql,
        clientId: input.clientId,
        status: 'error',
        detail: error.reason,
      });
      return err(error);
    }

    const risk = this.riskAssessor.assess(query, estimatedRows);
    const pending = new PendingWrite({
      id: this.ids.nextId(),
      sql: query.sql,
      kind,
      targetTable,
      estimatedRows,
      risk: risk.level,
      preview: buildPreview(kind, targetTable, estimatedRows),
      createdAt: this.clock.now(),
    });
    await this.store.save(pending);

    await this.audit.record({
      tool: TOOL,
      sql: query.sql,
      clientId: input.clientId,
      status: 'success',
      detail: `confirmation requested: ${pending.id} (risk=${risk.level})`,
    });

    return ok({
      confirmationId: pending.id,
      operation: kind.toUpperCase() as Uppercase<WriteKind>,
      targetTable,
      estimatedRows,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      preview: pending.preview,
      expiresInSeconds: Math.round(this.options.confirmationTtlMs / 1000),
      requires:
        risk.level === 'high'
          ? 'Explicit confirmation with risk acknowledgment (confirm_write with acknowledge_risk=true)'
          : 'Confirmation via confirm_write',
    });
  }
}

function buildPreview(kind: WriteKind, table: string, estimatedRows: number | null): string {
  const rows = estimatedRows === null ? 'unknown number of' : estimatedRows.toLocaleString('en-US');
  switch (kind) {
    case 'insert':
      return `Will insert ${rows} row(s) into ${table}`;
    case 'update':
      return `Will update ${rows} row(s) in ${table}`;
    case 'delete':
      return `Will permanently delete ${rows} row(s) from ${table}`;
  }
}
