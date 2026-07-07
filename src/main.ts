#!/usr/bin/env node
/**
 * MCPBridge entrypoint. Loads configuration, wires the container, and starts
 * the requested transport (stdio for local clients, Streamable HTTP for
 * remote hosting).
 *
 * IMPORTANT: in stdio mode, stdout carries the MCP protocol — all diagnostics
 * go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildContainer, Container } from './platform/composition/container.js';
import { loadConfig, redactSecrets } from './platform/config/Config.js';
import { buildServer } from './platform/mcp/buildServer.js';
import { startHttpServer } from './platform/mcp/startHttpServer.js';
import { SqlGenerationUnavailableError } from './search/application/SqlGenerator.js';
import { SamplingSqlGenerator } from './search/infrastructure/SamplingSqlGenerator.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // The SQL generator needs the live MCP server (for sampling), which in
  // turn needs the container — broken with a late-bound reference.
  const serverRef: { current: McpServer | null } = { current: null };
  const sqlGenerator = new SamplingSqlGenerator(() => {
    if (!serverRef.current) {
      throw new SqlGenerationUnavailableError('MCP server is not connected yet');
    }
    return serverRef.current;
  });

  const container = buildContainer(config, sqlGenerator);

  // Fail fast with a clear (redacted) message if the database is unreachable.
  try {
    await container.gateway.ping();
    console.error('[mcpbridge] connected to PostgreSQL');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[mcpbridge] cannot reach PostgreSQL: ${redactSecrets(message, config.secrets)}`);
    console.error('[mcpbridge] starting anyway; queries will fail until the database is reachable');
  }

  installShutdownHooks(container);

  if (config.transport === 'http') {
    startHttpServer(container, config.httpPort, (server) => {
      serverRef.current = server;
    });
    return;
  }

  const server = buildServer(container);
  serverRef.current = server;
  await server.connect(new StdioServerTransport());
  console.error(
    `[mcpbridge] ready on stdio (mode: ${config.readOnlyMode ? 'read-only' : 'read-write'}, ` +
      `schema: ${config.defaultSchema}, max rows: ${config.maxRows})`,
  );
}

function installShutdownHooks(container: Container): void {
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.error(`[mcpbridge] ${signal} received, closing connections`);
    try {
      await container.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[mcpbridge] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
