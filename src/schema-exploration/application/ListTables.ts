/**
 * Use case: list_tables — table inventory with row estimates and comments.
 */
import { TableSummary } from '../domain/types.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { SchemaService } from './SchemaService.js';
import { err, fromGatewayError, ok, UseCaseResult } from '../../shared/application/result.js';

const TOOL = 'list_tables';

export class ListTables {
  constructor(
    private readonly gate: OperationGate,
    private readonly schema: SchemaService,
    private readonly audit: AuditService,
  ) {}

  async execute(input: { schema: string; clientId: string }): Promise<UseCaseResult<TableSummary[]>> {
    const gate = await this.gate.pass(TOOL, input.clientId);
    if (!gate.ok) return err(gate.error);

    try {
      const started = Date.now();
      const tables = await this.schema.listTables(input.schema);
      await this.audit.record({
        tool: TOOL,
        clientId: input.clientId,
        status: 'success',
        executionTimeMs: Date.now() - started,
        rowsReturned: tables.length,
        detail: `schema=${input.schema}`,
      });
      return ok(tables);
    } catch (e) {
      const error = fromGatewayError(e);
      await this.audit.record({
        tool: TOOL,
        clientId: input.clientId,
        status: 'error',
        detail: error.reason,
      });
      return err(error);
    }
  }
}
