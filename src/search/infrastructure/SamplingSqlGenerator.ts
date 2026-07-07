/**
 * Interface layer: natural language → SQL via MCP sampling. Instead of
 * bundling an LLM API key, MCPBridge asks the *connected client's* model to
 * write the SQL — the MCP-idiomatic approach. Generated SQL still passes the
 * full domain validation pipeline before execution.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SqlGenerationUnavailableError,
  SqlGenerator,
} from '../application/SqlGenerator.js';

const SYSTEM_PROMPT = [
  'You translate natural language questions into a single read-only PostgreSQL query.',
  'Rules:',
  '- Output exactly one SELECT (or WITH ... SELECT) statement and nothing else.',
  '- Never produce INSERT, UPDATE, DELETE, DDL, or multiple statements.',
  '- Only reference tables and columns present in the provided schema.',
  '- Prefer explicit column lists over SELECT *.',
].join('\n');

export class SamplingSqlGenerator implements SqlGenerator {
  constructor(private readonly getServer: () => McpServer) {}

  async generateSql(question: string, schemaContext: string): Promise<string> {
    const server = this.getServer().server;
    if (!server.getClientCapabilities()?.sampling) {
      throw new SqlGenerationUnavailableError(
        'The connected MCP client does not support sampling, so natural-language search is unavailable. ' +
          'Write the SQL directly and use query_db instead.',
      );
    }

    const response = await server.createMessage({
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${schemaContext}\n\nQuestion: ${question}\n\nReply with only the SQL statement.`,
          },
        },
      ],
      maxTokens: 1000,
    });

    const text = response.content.type === 'text' ? response.content.text : '';
    const sql = extractSql(text);
    if (sql.length === 0) {
      throw new Error('The model returned no SQL');
    }
    return sql;
  }
}

/** Pulls the SQL out of a possibly fenced / chatty model response. */
export function extractSql(text: string): string {
  const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1]! : text).trim();
  // Drop any prose before the first SQL keyword.
  const start = candidate.search(/\b(select|with|explain|show|values)\b/i);
  return start >= 0 ? candidate.slice(start).trim() : '';
}
