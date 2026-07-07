/**
 * Search feature — presentation: the search_data natural-language tool.
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
import { SearchData } from '../application/SearchData.js';

export interface SearchDeps {
  searchData: SearchData;
}

export function registerSearch(server: McpServer, deps: SearchDeps): void {
  server.registerTool(
    'search_data',
    {
      title: 'Search data (natural language)',
      description:
        'Answer a natural language question about the data. Uses MCP sampling to generate ' +
        'SQL, validates it through the same safety pipeline as query_db, executes it, and ' +
        'returns both the generated SQL and the results.',
      inputSchema: {
        question: z
          .string()
          .describe('The question, e.g. "How many orders were placed last month?"'),
        execute: z
          .boolean()
          .optional()
          .describe('Set false to only generate and review the SQL without running it (default true)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ question, execute }): Promise<ToolResponse> => {
      const result = await deps.searchData.execute({
        question,
        execute: execute ?? true,
        clientId: clientIdOf(server),
      });
      if (!result.ok) return errorResponse(result.error);
      const v = result.value;
      const parts = ['Generated SQL:', '```sql', v.generatedSql, '```'];
      if (v.executed && v.result) {
        parts.push('\nResults:');
        parts.push(markdownTable(v.result.fields, v.result.rows));
        parts.push(`\n_${v.result.rowCount} row(s) in ${v.result.durationMs} ms_`);
      } else {
        parts.push('\n_Not executed (execute=false). Call query_db with this SQL to run it._');
      }
      if (v.warning) parts.push(`\n> ⚠️ ${v.warning}`);
      return textResponse(parts.join('\n'));
    },
  );
}
