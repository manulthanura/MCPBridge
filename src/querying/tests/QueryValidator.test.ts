import { describe, expect, it } from 'vitest';
import { QueryValidator } from '../domain/QueryValidator.js';
import { stripCommentsAndStrings } from '../domain/sql-text.js';

const validator = new QueryValidator();

describe('stripCommentsAndStrings', () => {
  it('blanks string literals so keywords inside them are invisible', () => {
    const stripped = stripCommentsAndStrings(`SELECT 'DROP TABLE users' AS note`);
    expect(stripped).not.toContain('DROP');
  });

  it('blanks line and block comments', () => {
    const stripped = stripCommentsAndStrings('SELECT 1 -- DROP TABLE x\n/* DELETE */');
    expect(stripped).not.toContain('DROP');
    expect(stripped).not.toContain('DELETE');
  });

  it('blanks dollar-quoted strings', () => {
    const stripped = stripCommentsAndStrings('SELECT $tag$ TRUNCATE users $tag$');
    expect(stripped).not.toContain('TRUNCATE');
  });
});

describe('QueryValidator.validateRead', () => {
  it('accepts a plain SELECT', () => {
    const result = validator.validateRead('SELECT name, email FROM users WHERE id = 42');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.query.kind).toBe('select');
  });

  it('accepts a read-only CTE', () => {
    const result = validator.validateRead('WITH a AS (SELECT 1 AS x) SELECT * FROM a');
    expect(result.ok).toBe(true);
  });

  it('blocks DROP TABLE', () => {
    const result = validator.validateRead('DROP TABLE users');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('query_blocked');
      expect(result.reason).toMatch(/DROP/);
    }
  });

  it('blocks TRUNCATE, ALTER, GRANT', () => {
    for (const sql of ['TRUNCATE orders', 'ALTER TABLE x ADD y int', 'GRANT ALL ON x TO evil']) {
      expect(validator.validateRead(sql).ok).toBe(false);
    }
  });

  it('blocks INSERT/UPDATE/DELETE on the read path with a write_db hint', () => {
    const result = validator.validateRead(`DELETE FROM orders WHERE status = 'draft'`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.hint).toMatch(/write_db/);
  });

  it('blocks multi-statement payloads (injection vector)', () => {
    const result = validator.validateRead(`SELECT 1; DELETE FROM users`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Multiple/i);
  });

  it('does not treat semicolons inside string literals as statement separators', () => {
    const result = validator.validateRead(`SELECT 'a;b' AS v FROM users LIMIT 5`);
    expect(result.ok).toBe(true);
  });

  it('blocks a write smuggled through a CTE', () => {
    const result = validator.validateRead(
      'WITH gone AS (DELETE FROM users RETURNING id) SELECT count(*) FROM gone',
    );
    expect(result.ok).toBe(false);
  });

  it('blocks access to credential catalogs', () => {
    const result = validator.validateRead('SELECT * FROM pg_shadow');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pg_shadow/);
  });

  it('blocks SELECT INTO (creates a table)', () => {
    expect(validator.validateRead('SELECT * INTO backup FROM users').ok).toBe(false);
  });

  it('rejects empty SQL as a syntax error', () => {
    const result = validator.validateRead('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('syntax_error');
  });

  it('is not fooled by dangerous keywords inside comments or strings', () => {
    const result = validator.validateRead(
      `SELECT note FROM audit WHERE note = 'DROP TABLE users' -- TRUNCATE nothing`,
    );
    expect(result.ok).toBe(true);
  });

  it('respects extra blocked tables from configuration', () => {
    const restricted = new QueryValidator({ blockedTables: ['salaries'] });
    expect(restricted.validateRead('SELECT * FROM salaries').ok).toBe(false);
  });
});

describe('QueryValidator.validateWrite', () => {
  it('accepts INSERT / UPDATE / DELETE', () => {
    for (const sql of [
      `INSERT INTO products (name, price) VALUES ('Widget', 9.99)`,
      `UPDATE products SET price = 10 WHERE id = 1`,
      `DELETE FROM products WHERE id = 1`,
    ]) {
      const result = validator.validateWrite(sql);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects SELECT on the write path', () => {
    const result = validator.validateWrite('SELECT 1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.hint).toMatch(/query_db/);
  });

  it('rejects DDL on the write path', () => {
    expect(validator.validateWrite('DROP TABLE users').ok).toBe(false);
    expect(validator.validateWrite('CREATE TABLE x (id int)').ok).toBe(false);
  });
});
