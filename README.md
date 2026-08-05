<a name="readme-top"></a>

# MCPBridge

[![Static Badge](https://img.shields.io/badge/Develop-Manul_Thanura-red)](https://lk.linkedin.com/in/manulthanura)
[![Static Badge](https://img.shields.io/badge/GitHub-View_Source-181717)](https://github.com/manulthanura/MCPBridge)
[![Static Badge](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![Static Badge](https://img.shields.io/badge/Version-1.0.0-blueviolet)](https://github.com/manulthanura/MCPBridge/releases)

[![Static Badge](https://img.shields.io/badge/TypeScript-blue)](https://www.typescriptlang.org/)
[![Static Badge](https://img.shields.io/badge/PostgreSQL-blue)](https://www.postgresql.org/)
[![Static Badge](https://img.shields.io/badge/MCP-orange)](https://modelcontextprotocol.io/)
[![Static Badge](https://img.shields.io/badge/Docker-2496ED)](https://www.docker.com/)

A production-grade [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants (Claude Desktop, Cursor, Windsurf, Claude Code, …) to **PostgreSQL** — with the guardrails a real database deserves.

![banner](./assets/readme.jpg)

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#features">Features</a></li>
    <li><a href="#architecture">Architecture</a></li>
    <li><a href="#tools">Tools</a></li>
    <li><a href="#resources--prompts">Resources & Prompts</a></li>
    <li><a href="#prerequisites">Prerequisites</a></li>
    <li><a href="#quick-start">Quick Start</a></li>
    <li><a href="#configuration">Configuration</a></li>
    <li><a href="#safety-model">Safety Model</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#security">Security</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgements">Acknowledgements</a></li>
  </ol>
</details>

## Features

Most database MCP servers are thin wrappers around `pool.query()`. MCPBridge adds the missing production layer:

- 🛡️ **Query safety validation** — DDL and multi-statement payloads are blocked; comments, string literals and dollar-quoted strings are stripped before keyword analysis so nothing can be smuggled past the validator; reads additionally run inside `READ ONLY` transactions as defence in depth.
- ✋ **Two-phase guarded writes** — `write_db` never executes anything. It stages the statement, estimates the affected rows via the planner, assigns a risk level, and returns a `confirmation_id`. Execution happens only through `confirm_write`; high-risk operations (bulk deletes, `UPDATE` without `WHERE`) require an explicit `acknowledge_risk=true`. Unconfirmed writes expire after 10 minutes.
- 📉 **Result limiting** — `SELECT` without `LIMIT` is automatically capped (default 100 rows) with a warning, so `SELECT * FROM events` can't flood the context window.
- 🧾 **Audit logging** — every operation (success, error, blocked, rate-limited) is appended to a JSONL audit trail with timing, row counts and client identity. Credentials are redacted from every log line and error message. Logs rotate at 10 MB.
- 🚦 **Rate limiting** — sliding-window limiter (default 100 requests/minute per client) that rejects *before* a database connection is consumed.
- 🧠 **Schema intelligence** — row estimates from planner statistics (never `COUNT(*)`), foreign-key relationship maps with cardinality, index inventories, column statistics, sample rows — all behind a 5-minute TTL cache.
- 🚨 **Anomaly detection** — `detect_anomalies` scans the audit trail for suspicious usage: bursts of queries against one table, sequential id-enumeration scans, and off-hours activity.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

![MCPBridge architecture](./assets/architecture.jpg)

**Feature-based architecture combined with DDD.** Each core feature is a bounded context living in its own folder under `src/`, with its Gherkin specification (`.feature`), its tests, and DDD layering inside (`domain` → `application` → `infrastructure` / `presentation`). Dependencies point inward within a feature; features depend only on `shared/`, `platform/`, and other features' public modules — never on the composition root.

```
features/                     # Gherkin specifications (Cucumber convention) — one .feature file per feature
src/
├── querying/                 # Feature: safe read-only querying
│   ├── domain/               #   SQL lexing, classification, validation, result limiting
│   ├── application/          #   ExecuteQuery, ExplainQuery use cases
│   ├── presentation/         #   query_db / explain_query tools, optimize-query prompt
│   └── tests/
├── schema-exploration/       # Feature: schema intelligence
│   ├── domain/               #   Table/column/relationship/statistics types
│   ├── application/          #   SchemaService (TTL cache), ListTables, DescribeTable
│   ├── infrastructure/       #   PostgreSQL catalog introspector
│   └── presentation/         #   list_tables / describe_table tools + schema:// table:// stats:// relations:// resources
├── guarded-writes/           # Feature: two-phase confirmed writes
│   ├── domain/               #   PendingWrite aggregate, RiskAssessor
│   ├── application/          #   RequestWrite, ConfirmWrite, RejectWrite
│   ├── infrastructure/       #   In-memory pending-write store
│   ├── presentation/         #   write_db / confirm_write / reject_write tools
│   └── tests/
├── search/                   # Feature: natural-language search
│   ├── application/          #   SearchData use case, SqlGenerator port
│   ├── infrastructure/       #   MCP-sampling SQL generator
│   └── presentation/         #   search_data tool
├── audit/                    # Feature: audit trail (JSONL logger, rotation, redaction) + anomaly detection
│   ├── domain/               #   AnomalyDetector: burst / sequential-scan / off-hours heuristics
│   ├── application/          #   AuditService, DetectAnomalies use case
│   ├── infrastructure/       #   JsonlAuditLogger, JsonlAuditReader
│   └── presentation/         #   detect_anomalies tool
├── throttling/               # Feature: rate limiting (sliding window + OperationGate)
├── shared/                   # Shared kernel: Clock, errors, result envelope, TTL cache, formatting, test fakes
├── platform/                 # Cross-feature plumbing: zod config, pg pool + gateway, MCP assembly, HTTP transport, composition root
└── main.ts                   # Entrypoint
docker/                       # Dockerfile, Dockerfile.dockerignore, docker-compose.yml
docs/                         # Architecture, folder structure, setup, development guides
```

Full documentation lives in [docs/](docs/): [architecture](docs/architecture.md) · [folder structure](docs/folder-structure.md) · [setup](docs/setup.md) · [development guidelines](docs/development.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Tools

| Tool | Description |
|------|-------------|
| `query_db` | Execute read-only SQL. Unbounded queries are capped with a warning. |
| `explain_query` | Show the execution plan (optionally `EXPLAIN ANALYZE`) with performance warnings. |
| `list_tables` | Tables/views with estimated row counts and comments. |
| `describe_table` | Columns, PK/FKs, indexes, relationships, sample rows, column stats. |
| `search_data` | Natural-language question → SQL (via MCP sampling) → validated → executed. |
| `write_db` | Stage an INSERT/UPDATE/DELETE; returns impact preview + `confirmation_id`. |
| `confirm_write` | Execute a staged write (high-risk requires `acknowledge_risk=true`). |
| `reject_write` | Cancel a staged write. |
| `detect_anomalies` | Scan the audit trail for suspicious usage patterns (table bursts, id-scan enumeration, off-hours activity). |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Resources & Prompts

- `schema://{schemaName}` — full schema snapshot (5-minute TTL cache)
- `table://{name}` / `stats://{table}` / `relations://{table}` — per-table structure, statistics, relationship map
- Prompts: `analyze-table`, `optimize-query`

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Prerequisites

- **Node.js** 18 or later
- **npm** (bundled with Node.js)
- A reachable **PostgreSQL** instance (13+) — or skip this and use the bundled [Docker Compose](#docker) setup, which provisions one with sample data

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Quick Start

```bash
npm install
npm run build
```

### Claude Desktop / Claude Code

Add to `claude_desktop_config.json` (or `.mcp.json` for Claude Code):

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

Restart the client — MCPBridge and its 9 tools appear immediately. Set `MCPBRIDGE_MODE=read-write` to enable the guarded write flow.

### Remote (Streamable HTTP)

```bash
MCPBRIDGE_TRANSPORT=http MCPBRIDGE_HTTP_PORT=3920 node dist/main.js
# MCP endpoint: http://localhost:3920/mcp
```

### Docker

All Docker assets live in [docker/](docker/):

```bash
docker compose -f docker/docker-compose.yml up     # PostgreSQL with sample data + MCPBridge on :3920
docker build -f docker/Dockerfile -t mcpbridge .   # image only (repo root as context)
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Configuration

Everything is environment-driven (see `.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection string (or use `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGPORT`) |
| `MCPBRIDGE_MODE` | `read-only` | `read-only` disables `write_db` entirely; `read-write` enables guarded writes |
| `MCPBRIDGE_DEFAULT_SCHEMA` | `public` | Schema used by tools and resources by default |
| `MCPBRIDGE_MAX_ROWS` | `100` | Cap applied to `SELECT`s without a `LIMIT` |
| `MCPBRIDGE_RATE_LIMIT` | `100` | Requests allowed per window per client |
| `MCPBRIDGE_RATE_WINDOW_SECONDS` | `60` | Rate-limit window |
| `MCPBRIDGE_QUERY_TIMEOUT_MS` | `30000` | `statement_timeout` for every query |
| `MCPBRIDGE_CONFIRMATION_TTL_SECONDS` | `600` | How long a staged write waits for confirmation |
| `MCPBRIDGE_SCHEMA_CACHE_TTL_SECONDS` | `300` | Schema cache TTL |
| `MCPBRIDGE_HIGH_RISK_ROW_THRESHOLD` | `100` | Estimated affected rows at which a write becomes high-risk |
| `MCPBRIDGE_MAX_CONNECTIONS` | `10` | Connection pool size |
| `MCPBRIDGE_AUDIT_LOG` | `mcpbridge-audit.jsonl` | Audit trail path (rotates at 10 MB) |
| `MCPBRIDGE_BLOCKED_TABLES` | — | Comma-separated extra tables to block (system credential catalogs are always blocked) |
| `MCPBRIDGE_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCPBRIDGE_HTTP_PORT` | `3920` | Port for the HTTP transport |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Safety Model

1. **Domain validation (fail closed).** Statements are lexed (comments/strings blanked), classified by kind, and checked against forbidden keywords (`DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `COPY`, …), credential catalogs (`pg_shadow`, `pg_authid`, …), multi-statement payloads, and CTE-smuggled writes (`WITH x AS (DELETE …) SELECT …`). Anything unclassifiable is rejected.
2. **Transactional enforcement.** Reads run in `BEGIN TRANSACTION READ ONLY` — PostgreSQL itself rejects any write that slips through. Writes run in their own transaction and roll back on failure.
3. **Human confirmation.** Writes are staged, previewed (operation, target table, planner row estimate, risk level) and only executed on explicit confirmation — twice for high-risk operations.
4. **Redaction everywhere.** Known secrets, connection-string passwords and `password=` pairs are scrubbed from every error message and audit line.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Development

```bash
npm run dev          # run from source (tsx)
npm test             # 81 unit tests (vitest), co-located per feature in <feature>/tests/
npm run typecheck
node scripts/smoke.mjs   # end-to-end MCP protocol smoke test over stdio
```

Behavioural specifications live in [features/](features/) as Gherkin files — one per feature (`features/safe-querying.feature`, `features/guarded-writes.feature`, …), following the standard Cucumber layout. They document the expected behaviour scenario by scenario and are the reference for the unit tests. See [docs/development.md](docs/development.md) for the full workflow and guidelines.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Core tool set: safe querying, schema intelligence, guarded writes, natural-language search, audit trail, anomaly detection
- [x] `stdio` and Streamable HTTP transports
- [x] Docker packaging with sample dataset
- [ ] Publish package to npm
- [ ] Persistent pending-write store (currently in-memory, single-instance only)
- [ ] Additional database engines (MySQL, SQLite)
- [ ] CI pipeline (lint, typecheck, test) via GitHub Actions

See the [open issues](https://github.com/manulthanura/MCPBridge/issues) for a full list of proposed features and known gaps.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions make the open-source community a great place to learn and build. Any contributions are **greatly appreciated**.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a pull request

Please make sure `npm test` and `npm run typecheck` pass before opening a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/development.md](docs/development.md) for the full guidelines.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Security

MCPBridge is designed to sit in front of a production database — if you find a vulnerability, please **do not** open a public issue. See [SECURITY.md](SECURITY.md) for how to report it privately.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Manul Thanura — [LinkedIn](https://lk.linkedin.com/in/manulthanura) · [manulthanura.com](https://manulthanura.com)

Project Link: [https://github.com/manulthanura/MCPBridge](https://github.com/manulthanura/MCPBridge)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgements

- [Best-README-Template](https://github.com/othneildrew/Best-README-Template) — structure this README is based on
- [Claude Desktop](https://claude.ai/desktop) and [Cursor](https://cursor.so/), whose guarded database access flows inspired MCPBridge. MCPBridge is not affiliated with either product.
- PostgreSQL is a registered trademark of the PostgreSQL Global Development Group. MCPBridge is not affiliated with the PostgreSQL project.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
