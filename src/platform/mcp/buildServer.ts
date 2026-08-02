/**
 * Platform — MCP server assembly: hands each feature's presentation module
 * its own narrow dependencies. Kept separate from transports so stdio and
 * HTTP modes share identical behaviour (compatibility spec C-02).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuditTools } from '../../audit/presentation/registerAuditTools.js';
import { registerGuardedWrites } from '../../guarded-writes/presentation/registerWriteTools.js';
import { registerQuerying } from '../../querying/presentation/registerQueryTools.js';
import { registerSchemaExploration } from '../../schema-exploration/presentation/registerSchemaExploration.js';
import { registerSearch } from '../../search/presentation/registerSearchTool.js';
import { Container } from '../composition/container.js';

export const SERVER_INFO = {
  name: 'mcpbridge',
  version: '0.1.0',
} as const;

export function buildServer(container: Container): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: [
      'MCPBridge connects you to a PostgreSQL database with safety guardrails.',
      'Start with list_tables / describe_table to understand the schema.',
      'Use query_db for read-only SQL; results without LIMIT are capped.',
      'Writes are two-phase: write_db stages the operation and returns a confirmation_id;',
      'ask the user, then call confirm_write (or reject_write). High-risk writes need acknowledge_risk=true.',
      'search_data answers natural-language questions when the client supports sampling.',
      'detect_anomalies scans the audit trail for suspicious usage patterns.',
    ].join(' '),
  });

  const { useCases, schemaService, config } = container;

  registerQuerying(server, {
    executeQuery: useCases.executeQuery,
    explainQuery: useCases.explainQuery,
    maxRows: config.maxRows,
  });
  registerSchemaExploration(server, {
    listTables: useCases.listTables,
    describeTable: useCases.describeTable,
    schemaService,
    defaultSchema: config.defaultSchema,
  });
  registerGuardedWrites(server, {
    requestWrite: useCases.requestWrite,
    confirmWrite: useCases.confirmWrite,
    rejectWrite: useCases.rejectWrite,
  });
  registerSearch(server, { searchData: useCases.searchData });
  registerAuditTools(server, { detectAnomalies: useCases.detectAnomalies });

  return server;
}
