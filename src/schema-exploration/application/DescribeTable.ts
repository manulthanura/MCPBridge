/**
 * Use case: describe_table — full picture of one table: columns, keys,
 * indexes, relationships, sample rows and column statistics.
 */
import {
  ColumnStatistics,
  Relationship,
  TableDetails,
} from '../domain/types.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { SchemaService } from './SchemaService.js';
import { err, fromGatewayError, ok, UseCaseResult } from '../../shared/application/result.js';

export interface DescribeTableOutput {
  details: TableDetails;
  relationships: Relationship[];
  sampleRows: Record<string, unknown>[];
  columnStats: ColumnStatistics[];
}

const TOOL = 'describe_table';
const SAMPLE_ROW_COUNT = 3;

export class DescribeTable {
  constructor(
    private readonly gate: OperationGate,
    private readonly schema: SchemaService,
    private readonly audit: AuditService,
  ) {}

  async execute(input: {
    schema: string;
    table: string;
    clientId: string;
  }): Promise<UseCaseResult<DescribeTableOutput>> {
    const gate = await this.gate.pass(TOOL, input.clientId);
    if (!gate.ok) return err(gate.error);

    try {
      const started = Date.now();
      const details = await this.schema.describeTable(input.schema, input.table);
      if (!details) {
        await this.audit.record({
          tool: TOOL,
          clientId: input.clientId,
          status: 'error',
          detail: `table not found: ${input.schema}.${input.table}`,
        });
        return err({
          code: 'table_not_found',
          reason: `Table "${input.schema}.${input.table}" does not exist`,
          hint: 'Use list_tables to see available tables',
        });
      }

      const [relationships, sampleRows, stats] = await Promise.all([
        this.schema.getRelationships(input.schema, input.table),
        this.schema
          .getSampleRows(input.schema, input.table, SAMPLE_ROW_COUNT)
          .catch(() => [] as Record<string, unknown>[]),
        this.schema.getTableStatistics(input.schema, input.table).catch(() => null),
      ]);

      await this.audit.record({
        tool: TOOL,
        clientId: input.clientId,
        status: 'success',
        executionTimeMs: Date.now() - started,
        detail: `table=${input.schema}.${input.table}`,
      });

      return ok({
        details,
        relationships,
        sampleRows,
        columnStats: stats?.columnStats ?? [],
      });
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
