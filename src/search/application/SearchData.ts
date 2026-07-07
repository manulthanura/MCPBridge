/**
 * Use case: search_data — natural language to SQL. The generated SQL goes
 * through exactly the same validation and limiting pipeline as hand-written
 * SQL, and is always returned to the caller for review alongside the results.
 */
import { QueryValidator } from '../../querying/domain/QueryValidator.js';
import { ResultLimitPolicy } from '../../querying/domain/ResultLimitPolicy.js';
import { DatabaseGateway, QueryResultData } from '../../platform/database/DatabaseGateway.js';
import { SqlGenerationUnavailableError, SqlGenerator } from './SqlGenerator.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { SchemaService } from '../../schema-exploration/application/SchemaService.js';
import { err, fromGatewayError, ok, UseCaseResult } from '../../shared/application/result.js';

export interface SearchDataOutput {
  generatedSql: string;
  executed: boolean;
  result?: QueryResultData;
  warning?: string;
}

const TOOL = 'search_data';

export class SearchData {
  constructor(
    private readonly gate: OperationGate,
    private readonly generator: SqlGenerator,
    private readonly schema: SchemaService,
    private readonly validator: QueryValidator,
    private readonly limitPolicy: ResultLimitPolicy,
    private readonly gateway: DatabaseGateway,
    private readonly audit: AuditService,
    private readonly defaultSchema: string,
  ) {}

  async execute(input: {
    question: string;
    /** When false, only generate and return the SQL without running it. */
    execute: boolean;
    clientId: string;
  }): Promise<UseCaseResult<SearchDataOutput>> {
    const gate = await this.gate.pass(TOOL, input.clientId);
    if (!gate.ok) return err(gate.error);

    let generatedSql: string;
    try {
      const schemaContext = await this.schema.getSchemaContext(this.defaultSchema);
      generatedSql = await this.generator.generateSql(input.question, schemaContext);
    } catch (e) {
      const reason =
        e instanceof SqlGenerationUnavailableError
          ? e.message
          : `SQL generation failed: ${e instanceof Error ? e.message : String(e)}`;
      await this.audit.record({
        tool: TOOL,
        clientId: input.clientId,
        status: 'error',
        detail: reason,
      });
      return err({
        code: 'sql_generation_failed',
        reason,
        hint: 'You can write the SQL yourself and use query_db instead',
      });
    }

    const validation = this.validator.validateRead(generatedSql);
    if (!validation.ok) {
      await this.audit.record({
        tool: TOOL,
        sql: generatedSql,
        clientId: input.clientId,
        status: 'blocked',
        detail: `generated SQL rejected: ${validation.reason}`,
      });
      return err({
        code: validation.error,
        reason: `The generated SQL was rejected by the safety validator: ${validation.reason}`,
        hint: 'Rephrase the question, or write the query manually with query_db',
        details: { generated_sql: generatedSql },
      });
    }

    if (!input.execute) {
      await this.audit.record({
        tool: TOOL,
        sql: generatedSql,
        clientId: input.clientId,
        status: 'success',
        detail: 'generated only (execute=false)',
      });
      return ok({ generatedSql: validation.query.sql, executed: false });
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
      const output: SearchDataOutput = {
        generatedSql: validation.query.sql,
        executed: true,
        result,
      };
      if (limited.limitApplied && result.rowCount >= limited.maxRows) {
        output.warning = `Result capped at ${limited.maxRows} rows.`;
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
      return err({ ...error, details: { ...error.details, generated_sql: generatedSql } });
    }
  }
}
