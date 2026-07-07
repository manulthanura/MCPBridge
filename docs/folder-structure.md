# Folder Structure

```
.
├── features/                     Gherkin specifications (standard Cucumber layout)
│   ├── safe-querying.feature           Querying behaviour contract
│   ├── schema-exploration.feature      Schema exploration scenarios
│   ├── guarded-writes.feature          Two-phase write confirmation scenarios
│   ├── natural-language-search.feature NL → SQL scenarios
│   ├── audit-logging.feature           Audit trail scenarios (+ @planned anomaly detection)
│   └── rate-limiting.feature           Throttling scenarios
│
├── src/                          All application source code
│   ├── main.ts                   Entrypoint: config → container → transport
│   │
│   ├── querying/                 FEATURE: safe read-only querying
│   │   ├── domain/                     Query.ts, sql-text.ts, QueryValidator.ts, ResultLimitPolicy.ts
│   │   ├── application/                ExecuteQuery.ts, ExplainQuery.ts
│   │   ├── presentation/               registerQueryTools.ts (query_db, explain_query, optimize-query prompt)
│   │   └── tests/
│   │
│   ├── schema-exploration/       FEATURE: schema intelligence
│   │   ├── domain/                     types.ts (TableDetails, Relationship, …)
│   │   ├── application/                SchemaIntrospector.ts (port), SchemaService.ts, ListTables.ts, DescribeTable.ts
│   │   ├── infrastructure/             PostgresSchemaIntrospector.ts
│   │   └── presentation/               registerSchemaExploration.ts (tools, schema:// table:// stats:// relations:// resources, analyze-table prompt)
│   │
│   ├── guarded-writes/           FEATURE: two-phase confirmed writes
│   │   ├── domain/                     PendingWrite.ts (aggregate), RiskAssessor.ts, target-table.ts
│   │   ├── application/                PendingWriteStore.ts (port), RequestWrite.ts, ConfirmWrite.ts, RejectWrite.ts
│   │   ├── infrastructure/             InMemoryPendingWriteStore.ts
│   │   ├── presentation/               registerWriteTools.ts (write_db, confirm_write, reject_write)
│   │   └── tests/
│   │
│   ├── search/                   FEATURE: natural-language search
│   │   ├── application/                SqlGenerator.ts (port), SearchData.ts
│   │   ├── infrastructure/             SamplingSqlGenerator.ts (MCP sampling)
│   │   └── presentation/               registerSearchTool.ts (search_data)
│   │
│   ├── audit/                    FEATURE: audit trail
│   │   ├── domain/                     AuditEntry.ts
│   │   ├── application/                AuditLogger.ts (port), AuditService.ts
│   │   └── infrastructure/             JsonlAuditLogger.ts (rotation + redaction)
│   │
│   ├── throttling/               FEATURE: rate limiting
│   │   ├── domain/                     SlidingWindowRateLimiter.ts
│   │   ├── application/                OperationGate.ts
│   │   └── tests/
│   │
│   ├── shared/                   SHARED KERNEL (no business rules)
│   │   ├── domain/                     Clock.ts, errors.ts, TtlCache.ts
│   │   ├── application/                result.ts (UseCaseResult), IdGenerator.ts (port)
│   │   ├── infrastructure/             SystemClock.ts, UuidGenerator.ts
│   │   ├── presentation/               formatting.ts (markdown tables, error payloads), client-id.ts
│   │   ├── testing/                    fakes.ts (FakeClock, FakeGateway, MemoryAuditLogger, …)
│   │   └── tests/
│   │
│   └── platform/                 CROSS-CUTTING PLUMBING
│       ├── config/                     Config.ts (zod env schema, redactSecrets)
│       ├── database/                   DatabaseGateway.ts (port), pool.ts, PostgresDatabaseGateway.ts
│       ├── mcp/                        buildServer.ts (assembles features), startHttpServer.ts
│       ├── composition/                container.ts (composition root — the ONLY wiring point)
│       └── tests/
│
├── docker/                       All Docker assets
│   ├── Dockerfile                      Multi-stage build (repo root as context)
│   ├── Dockerfile.dockerignore         Build-context ignores (BuildKit picks it up automatically)
│   └── docker-compose.yml              Postgres + MCPBridge for local trials
├── docs/                         Project documentation (this folder)
├── examples/                     claude_desktop_config.json, seed.sql (sample database)
├── scripts/                      smoke.mjs (end-to-end MCP protocol test over stdio)
├── .env.example                  Every configuration variable with defaults
├── package.json                  bin: mcpbridge → dist/main.js
└── tsconfig.json                 rootDir src → outDir dist
```

## Placement rules

| You are adding… | It goes in… |
|-----------------|-------------|
| A business rule / invariant | `src/<feature>/domain/` |
| A use case orchestrating a flow | `src/<feature>/application/` |
| An interface for something external | `src/<feature>/application/` (port), or `src/platform/database` if it is database plumbing |
| An adapter (pg, fs, HTTP, MCP sampling) | `src/<feature>/infrastructure/` |
| An MCP tool / resource / prompt | `src/<feature>/presentation/`, registered in `src/platform/mcp/buildServer.ts` |
| A behaviour scenario | `features/<feature-name>.feature` |
| A unit test | `src/<feature>/tests/` |
| A test double | `src/shared/testing/fakes.ts` |
| A new config variable | `src/platform/config/Config.ts` + `.env.example` + docs |

Build artefacts land in `dist/` (gitignored). `tests/` and `testing/` directories are excluded from the TypeScript build (see `tsconfig.json`) but included in the vitest run. Gherkin specs live outside `src/` in the root `features/` directory, the conventional Cucumber location.
