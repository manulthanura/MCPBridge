/**
 * Interface layer: Streamable HTTP transport for remote hosting. Stateless
 * mode — each request gets a fresh McpServer over the shared container, the
 * documented pattern for horizontally scalable deployments.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, IncomingMessage } from 'node:http';
import { Container } from '../composition/container.js';
import { buildServer } from './buildServer.js';

export function startHttpServer(
  container: Container,
  port: number,
  onServerBuilt?: (server: McpServer) => void,
): void {
  const httpServer = createServer(async (req, res) => {
    if (req.url?.split('?')[0] !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', hint: 'The MCP endpoint is /mcp' }));
      return;
    }

    try {
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
      const server = buildServer(container);
      onServerBuilt?.(server);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error('[mcpbridge] http request failed:', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(`[mcpbridge] Streamable HTTP transport listening on http://localhost:${port}/mcp`);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}
