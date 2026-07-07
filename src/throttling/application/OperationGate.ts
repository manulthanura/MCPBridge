/**
 * Application service: the entry checkpoint every tool invocation passes.
 * Enforces per-client rate limits *before* any database connection is used
 * and audit-logs rejected requests.
 */
import { SlidingWindowRateLimiter } from '../domain/SlidingWindowRateLimiter.js';
import { AuditService } from '../../audit/application/AuditService.js';
import { UseCaseError } from '../../shared/application/result.js';

export type GateDecision = { ok: true } | { ok: false; error: UseCaseError };

export class OperationGate {
  constructor(
    private readonly rateLimiter: SlidingWindowRateLimiter,
    private readonly audit: AuditService,
  ) {}

  async pass(tool: string, clientId: string): Promise<GateDecision> {
    const decision = this.rateLimiter.tryAcquire(clientId);
    if (decision.allowed) return { ok: true };

    await this.audit.record({
      tool,
      clientId,
      status: 'rate_limited',
      detail: `limit ${decision.limit}/${decision.windowSeconds}s, retry after ${decision.retryAfterSeconds}s`,
    });

    return {
      ok: false,
      error: {
        code: 'rate_limited',
        reason: `Rate limit exceeded: ${decision.limit} requests per ${decision.windowSeconds} seconds`,
        hint: `Retry after ${decision.retryAfterSeconds} seconds`,
        details: {
          limit: `${decision.limit} per ${decision.windowSeconds} seconds`,
          retry_after: decision.retryAfterSeconds,
        },
      },
    };
  }
}
