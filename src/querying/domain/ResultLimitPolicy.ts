/**
 * Querying context: guards against unbounded result sets (`SELECT *` on a
 * million-row table). SELECT statements without an explicit LIMIT are wrapped
 * in a limiting subquery; the caller receives a warning it can surface to
 * the user.
 */
import { ClassifiedQuery } from './Query.js';
import { containsKeyword } from './sql-text.js';

export interface LimitedQuery {
  sql: string;
  /** True when the policy injected a LIMIT the caller did not write. */
  limitApplied: boolean;
  maxRows: number;
}

export class ResultLimitPolicy {
  constructor(private readonly maxRows: number) {}

  apply(query: ClassifiedQuery): LimitedQuery {
    if (query.kind !== 'select' || this.hasExplicitLimit(query)) {
      return { sql: query.sql, limitApplied: false, maxRows: this.maxRows };
    }

    // Wrapping (rather than appending) keeps the original statement intact —
    // trailing ORDER BY, CTEs and set operations all keep their semantics.
    const sql = `SELECT * FROM (\n${query.sql}\n) AS mcpbridge_limited LIMIT ${this.maxRows}`;
    return { sql, limitApplied: true, maxRows: this.maxRows };
  }

  private hasExplicitLimit(query: ClassifiedQuery): boolean {
    return (
      /\blimit\s+\d+/i.test(query.stripped) ||
      containsKeyword(query.stripped, 'fetch')
    );
  }
}
