import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonlAuditReader } from '../infrastructure/JsonlAuditReader.js';
import { AuditEntry } from '../domain/AuditEntry.js';

function line(entry: AuditEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

describe('JsonlAuditReader', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcpbridge-audit-'));
    path = join(dir, 'audit.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty array when the log file does not exist yet', async () => {
    const reader = new JsonlAuditReader(path);
    expect(await reader.readSince(new Date(0))).toEqual([]);
  });

  it('parses entries and filters by timestamp', async () => {
    const old: AuditEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      tool: 'query_db',
      clientId: 'claude',
      status: 'success',
    };
    const recent: AuditEntry = {
      timestamp: '2026-01-01T01:00:00.000Z',
      tool: 'query_db',
      clientId: 'claude',
      status: 'success',
    };
    await writeFile(path, line(old) + line(recent), 'utf8');

    const reader = new JsonlAuditReader(path);
    const entries = await reader.readSince(new Date('2026-01-01T00:30:00.000Z'));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject(recent);
  });

  it('includes the rotated .1 file and returns entries oldest-first', async () => {
    const rotated: AuditEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      tool: 'query_db',
      clientId: 'claude',
      status: 'success',
      detail: 'rotated',
    };
    const current: AuditEntry = {
      timestamp: '2026-01-01T00:01:00.000Z',
      tool: 'query_db',
      clientId: 'claude',
      status: 'success',
      detail: 'current',
    };
    await writeFile(`${path}.1`, line(rotated), 'utf8');
    await writeFile(path, line(current), 'utf8');

    const reader = new JsonlAuditReader(path);
    const entries = await reader.readSince(new Date(0));

    expect(entries.map((e) => e.detail)).toEqual(['rotated', 'current']);
  });

  it('skips a malformed trailing line instead of failing the whole read', async () => {
    const ok: AuditEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      tool: 'query_db',
      clientId: 'claude',
      status: 'success',
    };
    await writeFile(path, `${line(ok)}{"incomplete":`, 'utf8');

    const reader = new JsonlAuditReader(path);
    const entries = await reader.readSince(new Date(0));

    expect(entries).toHaveLength(1);
  });
});
