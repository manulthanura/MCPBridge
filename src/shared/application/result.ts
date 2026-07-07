/**
 * Application layer: uniform result envelope for use cases. Use cases never
 * throw for expected failures (blocked queries, rate limits, expiry) — those
 * are outcomes the MCP layer must render, not exceptions.
 */
import { GatewayQueryError } from '../../platform/database/DatabaseGateway.js';

export interface UseCaseError {
  code: string;
  reason: string;
  hint?: string;
  details?: Record<string, unknown>;
}

export type UseCaseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: UseCaseError };

export function ok<T>(value: T): UseCaseResult<T> {
  return { ok: true, value };
}

export function err<T>(error: UseCaseError): UseCaseResult<T> {
  return { ok: false, error };
}

/** Maps database adapter failures into the use-case error envelope. */
export function fromGatewayError(e: unknown): UseCaseError {
  if (e instanceof GatewayQueryError) {
    return {
      code: e.code,
      reason: e.message,
      hint: e.hint,
      ...(e.position !== undefined ? { details: { position: e.position } } : {}),
    };
  }
  return {
    code: 'internal_error',
    reason: e instanceof Error ? e.message : String(e),
  };
}
