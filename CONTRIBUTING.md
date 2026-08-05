# Contributing to MCPBridge

Thanks for considering a contribution. This project uses a feature-based architecture combined with DDD — see [docs/architecture.md](docs/architecture.md) and [docs/folder-structure.md](docs/folder-structure.md) before making structural changes.

## Getting set up

```bash
npm install
npm run dev          # run from source (tsx)
npm test             # vitest, co-located per feature in <feature>/tests/
npm run typecheck
```

## Workflow

1. Fork the repository and create a branch off `main`: `git checkout -b feature/your-feature`.
2. If you're adding or changing behavior, update or add the relevant Gherkin spec under [features/](features/) first — it's the reference the unit tests are written against.
3. Keep changes inside the correct bounded context (`src/<feature>/domain|application|infrastructure|presentation`). Dependencies point inward; features may only depend on `shared/`, `platform/`, and other features' public modules.
4. Add or update tests alongside the code you change.
5. Run `npm test` and `npm run typecheck` and make sure both pass.
6. Open a pull request describing the change and linking any related issue.

## Reporting bugs

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and your Node.js / PostgreSQL versions. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of filing a public issue.

## Code style

Follow the existing TypeScript conventions in the file you're editing (naming, layering, error handling). No linter is configured yet — `npm run typecheck` is the current bar.
