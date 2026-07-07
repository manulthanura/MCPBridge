/**
 * Querying feature — presentation: the query_db / explain_query tools and
 * the optimize-query prompt. Thin adapters; all policy lives in the feature's
 * domain and application layers.
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
import { ExecuteQuery } from '../application/ExecuteQuery.js';
import { ExplainQuery } from '../application/ExplainQuery.js';

export interface QueryingDeps {
  executeQuery: ExecuteQuery;
  explainQuery: ExplainQuery;
  maxRows: number;
}

export function registerQuerying(server: McpServer, deps: QueryingDeps): void {
  server.registerTool(
    'query_db',
    {
      title: 'Query database',
      description:
        'Execute a read-only SQL query (SELECT / WITH / SHOW) against PostgreSQL. ' +
        `Queries without a LIMIT are capped at ${deps.maxRows} rows. ` +
        'Write statements are rejected — use write_db for those.',
      inputSchema: {
        sql: z.string().describe('The read-only SQL statement to execute'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sql }): Promise<ToolResponse> => {
      const result = await deps.executeQuery.execute({ sql, clientId: clientIdOf(server) });
      if (!result.ok) return errorResponse(result.error);
      const { rows, fields, rowCount, durationMs, warning } = result.value;
      const parts = [markdownTable(fields, rows), `\n_${rowCount} row(s) in ${durationMs} ms_`];
      if (warning) parts.push(`\n> ⚠️ ${warning}`);
      return textResponse(parts.join('\n'));
    },
  );

  server.registerTool(
    'explain_query',
    {
      title: 'Explain query plan',
      description:
        'Show the PostgreSQL execution plan for a read-only query without side effects. ' +
        'Set analyze=true to actually run the query and get real timings.',
      inputSchema: {
        sql: z
          .string()
          .describe('The read-only SQL statement to explain (without the EXPLAIN keyword)'),
        analyze: z
          .boolean()
          .optional()
          .describe('Run EXPLAIN ANALYZE for real row counts and timings (default false)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sql, analyze }): Promise<ToolResponse> => {
      const result = await deps.explainQuery.execute({
        sql,
        analyze: analyze ?? false,
        clientId: clientIdOf(server),
      });
      if (!result.ok) return errorResponse(result.error);
      const { planLines, warnings, analyzed } = result.value;
      const parts = [
        `Execution plan${analyzed ? ' (ANALYZE — query was executed)' : ' (estimated — query was NOT executed)'}:`,
        '```',
        planLines.join('\n'),
        '```',
      ];
      if (warnings.length > 0) {
        parts.push('Performance warnings:');
        parts.push(...warnings.map((w) => `- ⚠️ ${w}`));
      }
      return textResponse(parts.join('\n'));
    },
  );

  server.registerPrompt(
    'optimize-query',
    {
      title: 'Optimize a query',
      description: 'Review a SQL query for performance problems and suggest improvements',
      argsSchema: {
        sql: z.string().describe('The SQL query to optimize'),
      },
    },
    ({ sql }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Optimize this PostgreSQL query:',
              '```sql',
              sql,
              '```',
              '',
              '1. Call explain_query with this SQL to get the execution plan.',
              '2. Identify problems: sequential scans on large tables, missing indexes, misestimated rows, expensive sorts.',
              '3. Use describe_table on the involved tables to see the available indexes.',
              '4. Propose a rewritten query and/or index changes, and verify the improvement with explain_query.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
