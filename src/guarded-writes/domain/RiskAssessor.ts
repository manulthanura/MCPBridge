/**
 * Writes context: decides how dangerous a write operation is before it is
 * offered for confirmation. High-risk writes require double confirmation
 * (explicit risk acknowledgment) per the project's guarded-write spec.
 */
import { ClassifiedQuery, WriteKind } from '../../querying/domain/Query.js';
import { containsKeyword } from '../../querying/domain/sql-text.js';

export type RiskLevel = 'low' | 'high';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

export interface RiskAssessorOptions {
  /** Estimated affected rows at or above this count make a write high risk. */
  highRiskRowThreshold?: number;
}

const DEFAULT_HIGH_RISK_ROWS = 100;

export class RiskAssessor {
  private readonly highRiskRowThreshold: number;

  constructor(options: RiskAssessorOptions = {}) {
    this.highRiskRowThreshold = options.highRiskRowThreshold ?? DEFAULT_HIGH_RISK_ROWS;
  }

  assess(query: ClassifiedQuery, estimatedRows: number | null): RiskAssessment {
    const kind = query.kind as WriteKind;
    const reasons: string[] = [];

    if ((kind === 'update' || kind === 'delete') && !containsKeyword(query.stripped, 'where')) {
      reasons.push(`${kind.toUpperCase()} without a WHERE clause affects every row in the table`);
    }

    if (estimatedRows !== null && estimatedRows >= this.highRiskRowThreshold) {
      reasons.push(
        `Estimated ${estimatedRows.toLocaleString('en-US')} affected rows (threshold: ${this.highRiskRowThreshold})`,
      );
    }

    if (estimatedRows === null && kind !== 'insert') {
      reasons.push('Affected row count could not be estimated');
    }

    return reasons.length > 0 ? { level: 'high', reasons } : { level: 'low', reasons: [] };
  }
}
