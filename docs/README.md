# MCPBridge Documentation

MCPBridge is a production-grade Model Context Protocol (MCP) server that connects AI assistants to PostgreSQL with safety guardrails: query validation, two-phase guarded writes, result limiting, rate limiting, and audit logging.

| Document | Contents |
|----------|----------|
| [architecture.md](architecture.md) | Architectural style (DDD + feature-based), bounded contexts, dependency rules, request flow |
| [architecture.drawio.xml](architecture.drawio.xml) | Visual diagram of the same architecture — open at [diagrams.net](https://app.diagrams.net) (File → Open From → Device) or the draw.io VS Code extension |
| [folder-structure.md](folder-structure.md) | Complete folder layout and what belongs where |
| [setup.md](setup.md) | Installation, configuration reference, client integration (Claude Desktop, Cursor, …), Docker |
| [development.md](development.md) | Development workflow, testing strategy, Gherkin specs, coding guidelines, how to add a feature |

For a quick overview, start with the project [README](../README.md).
