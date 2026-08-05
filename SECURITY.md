# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ |
| < 1.0   | ❌ |

## Reporting a Vulnerability

MCPBridge sits in front of a real PostgreSQL database, so please report suspected vulnerabilities privately rather than opening a public issue.

Use [GitHub's private vulnerability reporting](https://github.com/manulthanura/MCPBridge/security/advisories/new) for this repository. Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal query, config, or tool call sequence is ideal)
- The MCPBridge version and PostgreSQL version you tested against

You should get an initial response within a few days. Please allow time for a fix to be released before any public disclosure.

## Scope

This applies to MCPBridge itself — the query validator, guarded-write flow, rate limiter, audit logger, and schema-introspection tools. It does not cover vulnerabilities in PostgreSQL, Node.js, or the MCP SDK; report those to their respective maintainers.
