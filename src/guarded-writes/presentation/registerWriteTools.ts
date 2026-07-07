/**
 * Guarded-writes feature — presentation: the two-phase write tools.
 * write_db stages, confirm_write executes, reject_write cancels.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { clientIdOf } from '../../shared/presentation/client-id.js';
import { errorResponse, textResponse, ToolResponse } from '../../shared/presentation/formatting.js';
import { ConfirmWrite } from '../application/ConfirmWrite.js';
import { RejectWrite } from '../application/RejectWrite.js';
import { RequestWrite } from '../application/RequestWrite.js';

export interface GuardedWritesDeps {
  requestWrite: RequestWrite;
  confirmWrite: ConfirmWrite;
  rejectWrite: RejectWrite;
}

export function registerGuardedWrites(server: McpServer, deps: GuardedWritesDeps): void {
  server.registerTool(
    'write_db',
    {
      title: 'Write to database (guarded)',
      description:
        'Stage an INSERT, UPDATE or DELETE for execution. The statement is NOT executed ' +
        'immediately: you get an impact preview and a confirmation_id, and must call ' +
        'confirm_write to execute (or reject_write to cancel). High-risk operations ' +
        'require acknowledge_risk=true on confirmation.',
      inputSchema: {
        sql: z.string().describe('The INSERT, UPDATE or DELETE statement'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ sql }): Promise<ToolResponse> => {
      const result = await deps.requestWrite.execute({ sql, clientId: clientIdOf(server) });
      if (!result.ok) return errorResponse(result.error);
      const v = result.value;
      const payload = {
        status: 'confirmation_required',
        confirmation_id: v.confirmationId,
        operation: v.operation,
        target_table: v.targetTable,
        estimated_affected_rows: v.estimatedRows,
        risk_level: v.riskLevel,
        ...(v.riskReasons.length > 0 ? { risk_reasons: v.riskReasons } : {}),
        preview: v.preview,
        expires_in_seconds: v.expiresInSeconds,
        requires: v.requires,
      };
      return textResponse(JSON.stringify(payload, null, 2));
    },
  );

  server.registerTool(
    'confirm_write',
    {
      title: 'Confirm pending write',
      description:
        'Execute a write operation previously staged with write_db. Ask the user before ' +
        'confirming. High-risk operations additionally require acknowledge_risk=true.',
      inputSchema: {
        confirmation_id: z.string().describe('The confirmation_id returned by write_db'),
        acknowledge_risk: z
          .boolean()
          .optional()
          .describe('Must be true to execute a high-risk operation'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ confirmation_id, acknowledge_risk }): Promise<ToolResponse> => {
      const result = await deps.confirmWrite.execute({
        confirmationId: confirmation_id,
        acknowledgeRisk: acknowledge_risk ?? false,
        clientId: clientIdOf(server),
      });
      if (!result.ok) return errorResponse(result.error);
      const v = result.value;
      const payload: Record<string, unknown> = {
        status: 'success',
        rows_affected: v.rowsAffected,
        target_table: v.targetTable,
        execution_time_ms: v.durationMs,
      };
      if (v.returnedRows.length > 0) payload.returned = v.returnedRows;
      return textResponse(JSON.stringify(payload, null, 2));
    },
  );

  server.registerTool(
    'reject_write',
    {
      title: 'Reject pending write',
      description: 'Cancel a write operation staged with write_db. No data is modified.',
      inputSchema: {
        confirmation_id: z.string().describe('The confirmation_id returned by write_db'),
      },
    },
    async ({ confirmation_id }): Promise<ToolResponse> => {
      const result = await deps.rejectWrite.execute({
        confirmationId: confirmation_id,
        clientId: clientIdOf(server),
      });
      if (!result.ok) return errorResponse(result.error);
      return textResponse(
        JSON.stringify(
          {
            status: 'rejected',
            confirmation_id: result.value.confirmationId,
            target_table: result.value.targetTable,
            note: 'No data was modified',
          },
          null,
          2,
        ),
      );
    },
  );
}
