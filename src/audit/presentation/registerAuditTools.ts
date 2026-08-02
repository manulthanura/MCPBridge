/**
 * Audit feature — presentation: the detect_anomalies tool. Lets an
 * administrator (via the AI assistant) ask MCPBridge to scan its own audit
 * trail for suspicious usage patterns.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { clientIdOf } from '../../shared/presentation/client-id.js';
import {
  errorResponse,
  markdownTable,
  textResponse,
  ToolResponse,
} from '../../shared/presentation/formatting.js';
import { DetectAnomalies } from '../application/DetectAnomalies.js';

export interface AuditDeps {
  detectAnomalies: DetectAnomalies;
}

export function registerAuditTools(server: McpServer, deps: AuditDeps): void {
  server.registerTool(
    'detect_anomalies',
    {
      title: 'Detect anomalies in the audit trail',
      description:
        'Scan the recent audit trail for suspicious usage patterns: bursts of queries against ' +
        'one table, sequential id-enumeration scans, and activity during unusual hours.',
      inputSchema: {
        lookback_minutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('How far back to analyze, in minutes (default 60)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ lookback_minutes }): Promise<ToolResponse> => {
      const result = await deps.detectAnomalies.execute({
        lookbackMinutes: lookback_minutes,
        clientId: clientIdOf(server),
      });
      if (!result.ok) return errorResponse(result.error);

      const { entriesAnalyzed, windowMinutes, anomalies } = result.value;
      const summary = `Analyzed ${entriesAnalyzed} audit entries from the last ${windowMinutes} minute(s).`;
      if (anomalies.length === 0) return textResponse(`${summary}\n\nNo anomalies detected.`);

      const table = markdownTable(
        ['pattern', 'alert_level', 'detail'],
        anomalies.map((a) => ({ pattern: a.pattern, alert_level: a.level, detail: a.detail })),
      );
      return textResponse(`${summary}\n\n${table}`);
    },
  );
}
