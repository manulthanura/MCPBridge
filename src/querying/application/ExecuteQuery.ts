/**
 * Use case: query_db — validated, limited, audited read-only execution.
 * Pipeline: rate gate → safety validation → result limiting → execution
 * (READ ONLY transaction) → audit.
 */
import { QueryValidator } from '../domain/QueryValidator.js';
import { ResultLimitPolicy } from '../domain/ResultLimitPolicy.js';
import { DatabaseGateway, QueryResultData } from '../../platform/database/DatabaseGateway.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { err, fromGatewayError, ok, UseCaseResult } from '../../shared/application/result.js';

export interface ExecuteQueryInput {
  sql: string;
  clientId: string;
}

export interface ExecuteQueryOutput extends QueryResultData {
  /** Set when the result limit policy modified the query. */
  warning?: string;
}

const TOOL = 'query_db';

export class ExecuteQuery {
  constructor(
    private readonly gate: OperationGate,
    private readonly validator: QueryValidator,
    private readonly limitPolicy: ResultLimitPolicy,
    private readonly gateway: DatabaseGateway,
    private readonly audit: AuditService,
  ) {}

  async execute(input: ExecuteQueryInput): Promise<UseCaseResult<ExecuteQueryOutput>> {
    const gate = await this.gate.pass(TOOL, input.clientId);
    if (!gate.ok) return err(gate.error);

    const validation = this.validator.validateRead(input.sql);
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

    const limited = this.limitPolicy.apply(validation.query);

    try {
      const result = await this.gateway.executeReadOnly(limited.sql);
      await this.audit.record({
        tool: TOOL,
        sql: limited.sql,
        clientId: input.clientId,
        status: 'success',
        executionTimeMs: result.durationMs,
        rowsReturned: result.rowCount,
      });

      const output: ExecuteQueryOutput = { ...result };
      if (limited.limitApplied && result.rowCount >= limited.maxRows) {
        output.warning =
          `Query had no LIMIT and was capped at ${limited.maxRows} rows. ` +
          'Add a WHERE clause or an explicit LIMIT/OFFSET for pagination.';
      }
      return ok(output);
    } catch (e) {
      const error = fromGatewayError(e);
      await this.audit.record({
        tool: TOOL,
        sql: limited.sql,
        clientId: input.clientId,
        status: 'error',
        detail: error.reason,
      });
      return err(error);
    }
  }
}
