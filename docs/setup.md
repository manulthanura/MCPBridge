# Setup

## Prerequisites

- Node.js ≥ 18 (developed on 22/26)
- A reachable PostgreSQL database (13–17 supported)
- Optionally Docker + Docker Compose for the containerized path

## Local installation

```bash
npm install
npm run build        # compiles src/ → dist/
```

Verify the toolchain:

```bash
npm test                 # unit tests
node scripts/smoke.mjs   # end-to-end MCP handshake over stdio (no database needed)
```

## Configuration

All configuration is environment-driven; `.env.example` lists every variable. Connection settings are required, everything else has safe defaults:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) |
| `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | — | Alternative to `DATABASE_URL` |
| `MCPBRIDGE_MODE` | `read-only` | `read-only` disables `write_db` entirely; `read-write` enables guarded writes |
| `MCPBRIDGE_DEFAULT_SCHEMA` | `public` | Schema used by tools/resources by default |
| `MCPBRIDGE_MAX_ROWS` | `100` | Cap applied to SELECTs without a LIMIT |
| `MCPBRIDGE_RATE_LIMIT` | `100` | Requests per window per client |
| `MCPBRIDGE_RATE_WINDOW_SECONDS` | `60` | Sliding rate-limit window |
| `MCPBRIDGE_QUERY_TIMEOUT_MS` | `30000` | `statement_timeout` for every query |
| `MCPBRIDGE_CONFIRMATION_TTL_SECONDS` | `600` | How long a staged write waits for confirmation |
| `MCPBRIDGE_SCHEMA_CACHE_TTL_SECONDS` | `300` | Schema snapshot cache TTL |
| `MCPBRIDGE_HIGH_RISK_ROW_THRESHOLD` | `100` | Estimated affected rows at which a write becomes high-risk |
| `MCPBRIDGE_MAX_CONNECTIONS` | `10` | Connection pool size |
| `MCPBRIDGE_AUDIT_LOG` | `mcpbridge-audit.jsonl` | Audit trail path (rotates at 10 MB) |
| `MCPBRIDGE_BLOCKED_TABLES` | — | Comma-separated extra blocked tables (credential catalogs are always blocked) |
| `MCPBRIDGE_TRANSPORT` | `stdio` | `stdio` (local clients) or `http` (remote hosting) |
| `MCPBRIDGE_HTTP_PORT` | `3920` | Port for the Streamable HTTP transport |

## Connecting an AI assistant

### Claude Desktop

Add to `claude_desktop_config.json` (see `examples/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mcpbridge": {
      "command": "node",
      "args": ["/absolute/path/to/mcpbridge/dist/main.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb",
        "MCPBRIDGE_MODE": "read-only"
      }
    }
  }
}
```

Restart Claude Desktop; the `mcpbridge` server and its 8 tools appear in the tools list.

### Claude Code / Cursor / Windsurf

Same shape in the client's MCP config (`.mcp.json` for Claude Code, `mcp.json` for Cursor). All clients use identical stdio semantics.

### Remote (Streamable HTTP)

```bash
MCPBRIDGE_TRANSPORT=http MCPBRIDGE_HTTP_PORT=3920 node dist/main.js
# MCP endpoint: http://localhost:3920/mcp
```

Note: `search_data` relies on MCP *sampling*, which stateless HTTP clients may not support; all other tools behave identically on both transports.

## Docker

All Docker assets live in `docker/`: the `Dockerfile`, its `Dockerfile.dockerignore` (BuildKit reads it automatically to keep the build context minimal), and `docker-compose.yml`. Builds expect the **repository root** as context:

```bash
docker build -f docker/Dockerfile -t mcpbridge .
docker run -e DATABASE_URL=postgresql://user:pass@host:5432/db -p 3920:3920 mcpbridge
```

Or bring up a complete playground (PostgreSQL 17 seeded with a sample shop schema + MCPBridge in read-write mode):

```bash
docker compose -f docker/docker-compose.yml up
```

## Troubleshooting

- **`cannot reach PostgreSQL` on startup** — the server still starts and serves schema-independent responses; queries fail with `connection_error` until the database is reachable. Check `DATABASE_URL`; error messages are credential-redacted by design.
- **`rate_limited` errors** — raise `MCPBRIDGE_RATE_LIMIT` or widen the window.
- **Writes rejected with "read-only mode"** — set `MCPBRIDGE_MODE=read-write`.
- **stdio protocol corruption** — never print to stdout in server code; all diagnostics must go to stderr.
