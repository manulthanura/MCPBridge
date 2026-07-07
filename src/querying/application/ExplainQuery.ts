/**
 * Use case: explain_query — show the execution plan for a read-only query
 * without side effects. ANALYZE (which actually runs the statement) is only
 * permitted because the validator guarantees the statement is read-only and
 * the gateway runs it inside a READ ONLY transaction.
 */
import { QueryValidator } from '../domain/QueryValidator.js';
import { DatabaseGateway } from '../../platform/database/DatabaseGateway.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { err, fromGatewayError, ok, UseCaseResult } from '../../shared/application/result.js';

export interface ExplainQueryInput {
  sql: string;
  /** When true, actually executes the (read-only) query to get real timings. */
  analyze: boolean;
  clientId: string;
}

export interface ExplainQueryOutput {
  planLines: string[];
  warnings: string[];
  analyzed: boolean;
}

const TOOL = 'explain_query';

export class ExplainQuery {
  constructor(
    private readonly gate: OperationGate,
    private readonly validator: QueryValidator,
    private readonly gateway: DatabaseGateway,
    private readonly audit: AuditService,
  ) {}

  async execute(input: ExplainQueryInput): Promise<UseCaseResult<ExplainQueryOutput>> {
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

    if (validation.query.kind === 'explain') {
      return err({
        code: 'query_blocked',
        reason: 'Pass the plain query — explain_query adds EXPLAIN itself',
        hint: 'Call explain_query with the SELECT statement only',
      });
    }

    try {
      const started = Date.now();
      const planLines = await this.gateway.explain(validation.query.sql, input.analyze);
      await this.audit.record({
        tool: TOOL,
        sql: validation.query.sql,
        clientId: input.clientId,
        status: 'success',
        executionTimeMs: Date.now() - started,
      });
      return ok({
        planLines,
        warnings: extractPlanWarnings(planLines),
        analyzed: input.analyze,
      });
    } catch (e) {
      const error = fromGatewayError(e);
      await this.audit.record({
        tool: TOOL,
        sql: validation.query.sql,
        clientId: input.clientId,
        status: 'error',
        detail: error.reason,
      });
      return err(error);
    }
  }
}

/** Surfaces the classic performance smells from a text-format plan. */
function extractPlanWarnings(planLines: string[]): string[] {
  const plan = planLines.join('\n');
  const warnings: string[] = [];
  if (/Seq Scan on/.test(plan)) {
    warnings.push('Sequential scan detected — a large table without a usable index will be slow');
  }
  if (/Nested Loop/.test(plan) && /rows=\d{6,}/.test(plan)) {
    warnings.push('Nested loop over a large row estimate — check join conditions and indexes');
  }
  if (/Sort Method: external/.test(plan)) {
    warnings.push('Sort spilled to disk — consider an index matching the ORDER BY');
  }
  return warnings;
}
