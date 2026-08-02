/**
 * Audit context: one flagged pattern from the anomaly detector.
 */

export type AlertLevel = 'info' | 'warning' | 'high';

export interface Anomaly {
  pattern: string;
  level: AlertLevel;
  detail: string;
}
