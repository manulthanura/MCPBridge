# Development Guidelines

## Daily workflow

```bash
npm run dev              # run from source (tsx src/main.ts)
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (all feature test suites)
npm run test:watch       # vitest watch mode
npm run build            # compile to dist/
node scripts/smoke.mjs   # real MCP round-trip against dist/ (build first)
```

A change is "done" when typecheck, tests and the smoke test all pass.

## Testing strategy

Three complementary levels:

1. **Gherkin specifications** (`features/<name>.feature`, standard Cucumber layout) — the behaviour contract, written first. Every scenario describes observable behaviour through the MCP surface (tool called → outcome), not implementation detail. Scenarios for planned-but-unimplemented behaviour carry the `@planned` tag. When behaviour changes, change the `.feature` file in the same commit.
2. **Unit tests** (`src/<feature>/tests/`) — vitest, colocated with the feature. Domain logic is tested directly (it is pure); use cases are tested with the deterministic fakes from `src/shared/testing/fakes.ts` (`FakeClock`, `FakeGateway`, `MemoryAuditLogger`, `SequenceIdGenerator`, `StubSqlGenerator`). No test touches a real database.
3. **Protocol smoke test** (`scripts/smoke.mjs`) — drives the built server over real stdio with the MCP SDK client: tool/resource/prompt discovery, a blocked query, a redacted connection error, read-only-mode write rejection.

Conventions:

- Time never comes from `Date.now()` in domain/application code — inject `Clock` so expiry/window tests can advance a `FakeClock`.
- Test the *outcome envelope*, not internals: assert on `result.ok`, `error.code`, audit entry status.
- Every safety property (S-01…S-07 in CLAUDE.md) should have at least one test that attempts to violate it.

## Coding guidelines

- **Fail closed.** Anything the query validator cannot confidently classify is rejected. Prefer over-blocking to under-blocking.
- **Expected failures are results, not exceptions.** Use cases return `UseCaseResult<T>`; only adapters throw, and only `GatewayQueryError` escapes the database layer.
- **stdout is sacred** in stdio mode — it carries the protocol. `console.error` only.
- **Redact before you emit.** Any string that might contain credentials passes `redactSecrets` before logging or returning.
- **Ports before adapters.** New external dependencies get an interface in the feature's `application/` and an implementation in `infrastructure/`; the container wires them.
- **Keep the composition root the only wiring point.** No feature constructs another feature's adapters.
- Naming: `PascalCase.ts` for classes/aggregates/use cases, `kebab-case.ts` for function modules, one concept per file.
- Comments state constraints the code can't (invariants, protocol requirements, safety reasoning) — not what the next line does.

## Adding a new feature (bounded context)

1. Create `src/<feature-name>/` with the layers you need, and a `features/<feature-name>.feature` Gherkin spec describing the behaviour.
2. Model the domain first: value objects, aggregates, domain services — pure TypeScript, no I/O.
3. Add use cases in `application/`, taking `OperationGate` and `AuditService` if they serve MCP traffic (every tool must be rate-limited and audited).
4. Implement adapters in `infrastructure/` behind ports.
5. Expose it in `presentation/` as a `register<Feature>(server, deps)` function with a narrow deps interface.
6. Wire it: construct in `src/platform/composition/container.ts`, register in `src/platform/mcp/buildServer.ts`.
7. Add tests in `src/<feature-name>/tests/`; extend `scripts/smoke.mjs` if the feature adds tools.
8. Document: new config → `docs/setup.md` + `.env.example`; structural changes → `docs/folder-structure.md`.

## Adding a new tool to an existing feature

Add the use case (application), register the tool in the feature's presentation module, wire any new dependency in the container, cover it with tests, and describe the behaviour in the feature's spec under `features/`.

## Release checklist

1. `npm run typecheck && npm test && npm run build && node scripts/smoke.mjs`
2. Bump `version` in `package.json` and `SERVER_INFO` in `src/platform/mcp/buildServer.ts`.
3. `npm pack --dry-run` — confirm only `dist/`, `README.md`, `LICENSE` ship.
4. Verify the Docker image: `docker build -f docker/Dockerfile -t mcpbridge . && docker compose -f docker/docker-compose.yml up`.
