import { describe, expect, it } from 'vitest';
import { QueryValidator } from '../domain/QueryValidator.js';
import { ResultLimitPolicy } from '../domain/ResultLimitPolicy.js';

const validator = new QueryValidator();
const policy = new ResultLimitPolicy(100);

function classify(sql: string) {
  const result = validator.validateRead(sql);
  if (!result.ok) throw new Error(`expected valid SQL: ${sql}`);
  return result.query;
}

describe('ResultLimitPolicy', () => {
  it('wraps a SELECT without LIMIT', () => {
    const limited = policy.apply(classify('SELECT * FROM orders'));
    expect(limited.limitApplied).toBe(true);
    expect(limited.sql).toMatch(/LIMIT 100/);
    expect(limited.sql).toContain('SELECT * FROM orders');
  });

  it('leaves a query with an explicit LIMIT untouched', () => {
    const sql = 'SELECT * FROM orders LIMIT 10';
    const limited = policy.apply(classify(sql));
    expect(limited.limitApplied).toBe(false);
    expect(limited.sql).toBe(sql);
  });

  it('is not fooled by the word limit inside a string literal', () => {
    const limited = policy.apply(classify(`SELECT 'limit 5' AS note FROM orders`));
    expect(limited.limitApplied).toBe(true);
  });

  it('does not wrap SHOW statements', () => {
    const limited = policy.apply(classify('SHOW search_path'));
    expect(limited.limitApplied).toBe(false);
  });
});
