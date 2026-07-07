import { describe, expect, it } from 'vitest';
import { loadConfig, redactSecrets } from '../config/Config.js';

describe('loadConfig', () => {
  it('builds config from DATABASE_URL with safe defaults', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://app:s3cret@db:5432/shop' });
    expect(config.readOnlyMode).toBe(true); // safe default
    expect(config.maxRows).toBe(100);
    expect(config.rateLimit).toBe(100);
    expect(config.secrets).toContain('s3cret');
  });

  it('assembles a connection string from PG* variables', () => {
    const config = loadConfig({
      PGHOST: 'localhost',
      PGDATABASE: 'shop',
      PGUSER: 'app',
      PGPASSWORD: 'p@ss',
    });
    expect(config.connectionString).toContain('localhost');
    expect(config.secrets).toContain('p@ss');
  });

  it('throws a clear error when no connection is configured', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('parses blocked tables and read-write mode', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://u@h/db',
      MCPBRIDGE_MODE: 'read-write',
      MCPBRIDGE_BLOCKED_TABLES: 'salaries, Secrets',
    });
    expect(config.readOnlyMode).toBe(false);
    expect(config.blockedTables).toEqual(['salaries', 'secrets']);
  });
});

describe('redactSecrets (S-02: credential exposure)', () => {
  it('removes known secrets from messages', () => {
    const message = 'connection to server failed: password "s3cret" rejected';
    expect(redactSecrets(message, ['s3cret'])).not.toContain('s3cret');
  });

  it('redacts passwords embedded in connection strings', () => {
    const message = 'could not connect: postgresql://app:hunter2@db:5432/shop';
    const redacted = redactSecrets(message, []);
    expect(redacted).not.toContain('hunter2');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts password key-value pairs', () => {
    const redacted = redactSecrets('auth failed for password=topsecret host=db', []);
    expect(redacted).not.toContain('topsecret');
  });
});
