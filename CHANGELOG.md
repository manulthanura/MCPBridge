# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-08-05

### Added

- Core MCP tools: `query_db`, `explain_query`, `list_tables`, `describe_table`, `search_data`, `write_db`, `confirm_write`, `reject_write`, `detect_anomalies`
- Two-phase guarded writes with planner-based row estimation, risk scoring, and confirmation expiry
- Query safety validation (DDL/multi-statement blocking, credential-catalog blocklist, CTE-smuggled write detection)
- Automatic result limiting on unbounded `SELECT`s
- JSONL audit trail with redaction and log rotation
- Sliding-window rate limiting
- Schema intelligence resources (`schema://`, `table://`, `stats://`, `relations://`) with TTL caching
- Anomaly detection over the audit trail (table bursts, sequential id-scans, off-hours activity)
- `stdio` and Streamable HTTP transports
- Docker packaging with a sample dataset
