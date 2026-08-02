/**
 * Smoke test: drive the built server over real stdio MCP using the SDK
 * client. The database is unreachable on purpose — tool listing, resource
 * listing, prompt listing and the error path must still work.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/main.js'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://smoke:nope@127.0.0.1:59999/absent',
    MCPBRIDGE_AUDIT_LOG: process.env.SMOKE_AUDIT_LOG ?? 'smoke-audit.jsonl',
  },
});

const client = new Client({ name: 'smoke-client', version: '0.0.1' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).sort().join(','));

const resources = await client.listResourceTemplates();
console.log('RESOURCE_TEMPLATES:', resources.resourceTemplates.map((r) => r.uriTemplate).sort().join(','));

const prompts = await client.listPrompts();
console.log('PROMPTS:', prompts.prompts.map((p) => p.name).sort().join(','));

// Blocked query: must be rejected by the validator without a database.
const blocked = await client.callTool({ name: 'query_db', arguments: { sql: 'DROP TABLE users' } });
console.log('BLOCKED_IS_ERROR:', blocked.isError === true, '| body:', blocked.content[0].text.replaceAll('\n', ' '));

// Valid query: passes validation, then fails with a clear connection error.
const connFail = await client.callTool({ name: 'query_db', arguments: { sql: 'SELECT 1 AS one LIMIT 1' } });
const body = connFail.content[0].text;
console.log('CONN_ERROR_IS_ERROR:', connFail.isError === true);
console.log('CONN_ERROR_REDACTED:', !body.includes('nope'));

// Write in read-only mode (default): must be blocked.
const writeBlocked = await client.callTool({
  name: 'write_db',
  arguments: { sql: "INSERT INTO t (a) VALUES ('x')" },
});
console.log('WRITE_BLOCKED:', writeBlocked.isError === true, '| body:', writeBlocked.content[0].text.replaceAll('\n', ' ').slice(0, 160));

await client.close();
console.log('SMOKE_OK');
