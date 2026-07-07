# Architecture

MCPBridge combines **Domain-Driven Design (DDD)** with a **feature-based (vertical slice) architecture**. Code is organized by *business capability* first and technical role second: each feature is a bounded context in its own folder under `src/`, containing its own DDD layers, tests, and Gherkin specification.

## Why this style

A layer-first layout (`domain/`, `application/`, `infrastructure/` at the top) scatters one capability across the whole tree — changing the write-confirmation flow means touching four distant folders. Organizing by feature keeps everything about one capability together, while DDD layering *inside* each feature preserves the dependency discipline that makes the domain logic testable without I/O.

## Bounded contexts (features)

| Feature | Responsibility | Key domain concepts |
|---------|----------------|---------------------|
| `querying` | Safe read-only SQL execution | `ClassifiedQuery` value object, `QueryValidator` (fail-closed policy gate), `ResultLimitPolicy` |
| `schema-exploration` | Understanding database structure | `TableDetails`, `Relationship`, snapshot caching via `SchemaService` |
| `guarded-writes` | Two-phase confirmed mutations | `PendingWrite` aggregate root, `RiskAssessor` domain service |
| `search` | Natural language → SQL | `SqlGenerator` port, generated-SQL revalidation |
| `audit` | Tamper-evident operation trail | `AuditEntry`, redaction rules |
| `throttling` | Per-client rate limiting | `SlidingWindowRateLimiter`, `OperationGate` |

Two non-feature areas support them:

- **`shared/`** — the *shared kernel*: tiny, stable abstractions used by every context (Clock, error hierarchy, `UseCaseResult` envelope, TTL cache, MCP response formatting, test fakes). Nothing here contains business rules.
- **`platform/`** — cross-cutting plumbing that is not a business capability: zod-validated configuration, the PostgreSQL pool and `DatabaseGateway`, MCP server assembly, the Streamable HTTP transport, and the **composition root**.

## Layers inside a feature

Each feature applies the same inward-pointing layering:

```
src/<feature>/
├── domain/               Pure business logic — no I/O, no SDK, no pg imports
├── application/          Use cases + ports (interfaces the outside must implement)
├── infrastructure/       Adapters implementing the ports (pg, fs, MCP sampling)
├── presentation/         MCP tool/resource/prompt registration (thin adapters)
└── tests/                Unit tests for the feature
```

Each feature's behaviour contract lives as a Gherkin specification in the root `features/` directory (standard Cucumber layout), named after the feature (e.g. `features/guarded-writes.feature`).

Not every feature needs every layer (e.g. `throttling` has no infrastructure; `audit` has no presentation).

## Dependency rules

1. **Within a feature**: `domain` imports nothing outside itself and `shared/domain`. `application` may import `domain` and ports. `infrastructure`/`presentation` may import `application` and `domain`.
2. **Across features**: a feature may import another feature's `domain`/`application` modules when contexts genuinely relate (e.g. `guarded-writes` uses `querying`'s `ClassifiedQuery`; every use case passes `throttling`'s `OperationGate` and records to `audit`'s `AuditService`).
3. **Everyone** may import `shared/` and `platform/config`/`platform/database`.
4. **No feature imports `platform/composition` or `platform/mcp`** — composition knows the features, never the reverse.
5. `src/main.ts` is the only entrypoint; it wires config → container → transport.

## Request flow

```
MCP client (Claude Desktop / Cursor / …)
   │  JSON-RPC over stdio or Streamable HTTP
   ▼
presentation (feature tool, e.g. query_db)        ── parse input, render output
   ▼
OperationGate (throttling)                        ── rate limit BEFORE any DB work, audit rejections
   ▼
use case (application, e.g. ExecuteQuery)         ── orchestrates the pipeline
   ▼
domain policies (QueryValidator, ResultLimitPolicy…) ── pure decisions, fail closed
   ▼
DatabaseGateway (platform/database)               ── READ ONLY transactions, timeouts, error mapping + redaction
   ▼
PostgreSQL
```

Every path — success, validation block, database error, rate-limit rejection — ends with exactly one `AuditService.record(...)` call.

## Error handling model

Use cases return a discriminated `UseCaseResult<T>` (`{ ok: true, value } | { ok: false, error }`) rather than throwing for expected outcomes. Blocked queries, expired confirmations and rate limits are *outcomes to render*, not exceptions. Only adapters throw (`GatewayQueryError`), and use cases translate those at the boundary. All error text passes through credential redaction.

## The guarded write flow (core domain)

The most important invariants live in the `PendingWrite` aggregate — they cannot be bypassed by outer layers:

1. `write_db` validates the statement (INSERT/UPDATE/DELETE only), estimates impact via `EXPLAIN` (never executes), assigns risk, and stores a `PendingWrite` with a `confirmation_id`.
2. `confirm_write` transitions the aggregate: expired → rejected with expiry; high-risk → requires `acknowledge_risk=true`; already resolved → rejected. Only a successful transition reaches the database, inside a transaction.
3. `reject_write` cancels; unconfirmed writes expire after a TTL (default 10 minutes).
4. A server restart clears pending writes — the safe failure mode.

## Defence in depth

Domain validation is the policy layer, not the only protection:

- Reads execute inside `BEGIN TRANSACTION READ ONLY`; PostgreSQL rejects any write that slipped through.
- `statement_timeout` bounds every query.
- Rate limiting rejects before a pool connection is consumed.
- Credential redaction applies to every error message and audit line.
- System credential catalogs (`pg_shadow`, `pg_authid`, …) are blocked at the validator.
