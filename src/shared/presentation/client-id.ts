/**
 * Shared presentation helper: identity of the connected MCP client, used as
 * the rate-limit key and the clientId in audit entries.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function clientIdOf(server: McpServer): string {
  return server.server.getClientVersion()?.name ?? 'unknown-client';
}
