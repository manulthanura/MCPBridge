/**
 * Writes context: the PendingWrite aggregate — a write operation that has
 * been validated and impact-assessed but NOT executed. Execution requires an
 * explicit confirmation carrying the confirmation id; high-risk operations
 * additionally require the confirmer to acknowledge the risk.
 *
 * All state transitions live here so the invariants (single resolution,
 * expiry, risk acknowledgment) cannot be bypassed by the layers above.
 */
import { WriteKind } from '../../querying/domain/Query.js';
import { RiskLevel } from './RiskAssessor.js';

export type PendingWriteStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';

export type ConfirmOutcome =
  | { ok: true }
  | { ok: false; code: 'expired' | 'already_resolved' | 'risk_not_acknowledged'; reason: string };

export interface PendingWriteProps {
  id: string;
  sql: string;
  kind: WriteKind;
  targetTable: string;
  estimatedRows: number | null;
  risk: RiskLevel;
  preview: string;
  createdAt: Date;
}

export class PendingWrite {
  readonly id: string;
  readonly sql: string;
  readonly kind: WriteKind;
  readonly targetTable: string;
  readonly estimatedRows: number | null;
  readonly risk: RiskLevel;
  readonly preview: string;
  readonly createdAt: Date;
  private _status: PendingWriteStatus = 'pending';

  constructor(props: PendingWriteProps) {
    this.id = props.id;
    this.sql = props.sql;
    this.kind = props.kind;
    this.targetTable = props.targetTable;
    this.estimatedRows = props.estimatedRows;
    this.risk = props.risk;
    this.preview = props.preview;
    this.createdAt = props.createdAt;
  }

  get status(): PendingWriteStatus {
    return this._status;
  }

  isExpired(now: Date, ttlMs: number): boolean {
    return now.getTime() - this.createdAt.getTime() > ttlMs;
  }

  /** Marks the write expired if its confirmation window has passed. */
  expireIfDue(now: Date, ttlMs: number): boolean {
    if (this._status === 'pending' && this.isExpired(now, ttlMs)) {
      this._status = 'expired';
      return true;
    }
    return false;
  }

  confirm(now: Date, ttlMs: number, acknowledgeRisk: boolean): ConfirmOutcome {
    if (this.expireIfDue(now, ttlMs) || this._status === 'expired') {
      return {
        ok: false,
        code: 'expired',
        reason: 'This pending write operation has expired and was automatically cancelled',
      };
    }
    if (this._status !== 'pending') {
      return {
        ok: false,
        code: 'already_resolved',
        reason: `This operation was already ${this._status}`,
      };
    }
    if (this.risk === 'high' && !acknowledgeRisk) {
      return {
        ok: false,
        code: 'risk_not_acknowledged',
        reason: `This is a HIGH RISK operation (${this.describeImpact()}). Confirm again with acknowledge_risk=true to proceed.`,
      };
    }
    this._status = 'confirmed';
    return { ok: true };
  }

  reject(now: Date, ttlMs: number): ConfirmOutcome {
    if (this.expireIfDue(now, ttlMs) || this._status === 'expired') {
      return {
        ok: false,
        code: 'expired',
        reason: 'This pending write operation had already expired',
      };
    }
    if (this._status !== 'pending') {
      return {
        ok: false,
        code: 'already_resolved',
        reason: `This operation was already ${this._status}`,
      };
    }
    this._status = 'rejected';
    return { ok: true };
  }

  describeImpact(): string {
    const rows =
      this.estimatedRows === null ? 'an unknown number of' : this.estimatedRows.toLocaleString('en-US');
    switch (this.kind) {
      case 'delete':
        return `will delete ${rows} row(s) from ${this.targetTable}`;
      case 'update':
        return `will update ${rows} row(s) in ${this.targetTable}`;
      case 'insert':
        return `will insert ${rows} row(s) into ${this.targetTable}`;
    }
  }
}
