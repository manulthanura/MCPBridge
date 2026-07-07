import { describe, expect, it } from 'vitest';
import { QueryValidator } from '../../querying/domain/QueryValidator.js';
import { RiskAssessor } from '../domain/RiskAssessor.js';
import { extractTargetTable } from '../domain/target-table.js';
import { WriteKind } from '../../querying/domain/Query.js';

const validator = new QueryValidator();
const assessor = new RiskAssessor({ highRiskRowThreshold: 100 });

function classify(sql: string) {
  const result = validator.validateWrite(sql);
  if (!result.ok) throw new Error(`expected valid write: ${sql}`);
  return result.query;
}

describe('RiskAssessor', () => {
  it('rates a single-row insert as low risk', () => {
    const query = classify(`INSERT INTO products (name) VALUES ('Widget')`);
    expect(assessor.assess(query, 1).level).toBe('low');
  });

  it('rates a mass delete as high risk', () => {
    const query = classify(`DELETE FROM orders WHERE status = 'draft'`);
    const assessment = assessor.assess(query, 1247);
    expect(assessment.level).toBe('high');
    expect(assessment.reasons.join(' ')).toMatch(/1,247/);
  });

  it('rates UPDATE without WHERE as high risk regardless of estimate', () => {
    const query = classify(`UPDATE products SET price = 0`);
    expect(assessor.assess(query, 5).level).toBe('high');
  });

  it('rates an unestimatable delete as high risk', () => {
    const query = classify(`DELETE FROM orders WHERE id = 5`);
    expect(assessor.assess(query, null).level).toBe('high');
  });
});

describe('extractTargetTable', () => {
  const cases: Array<[string, WriteKind, string]> = [
    [`INSERT INTO products (name) VALUES ('x')`, 'insert', 'products'],
    [`UPDATE public.orders SET total = 1`, 'update', 'public.orders'],
    [`DELETE FROM "Order Items" WHERE id = 1`, 'delete', '"Order Items"'],
  ];

  for (const [sql, kind, expected] of cases) {
    it(`extracts ${expected} from ${kind}`, () => {
      expect(extractTargetTable(sql, kind)).toBe(expected);
    });
  }
});
