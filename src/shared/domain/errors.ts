/**
 * Shared kernel: domain error hierarchy. Every domain error carries a
 * machine-readable code (stable API surface for MCP clients) and an
 * optional hint telling the caller how to proceed.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class QueryBlockedError extends DomainError {
  constructor(reason: string, hint?: string) {
    super(reason, 'query_blocked', hint);
  }
}

export class RateLimitedError extends DomainError {
  constructor(
    readonly limit: number,
    readonly windowSeconds: number,
    readonly retryAfterSeconds: number,
  ) {
    super(
      `Rate limit of ${limit} requests per ${windowSeconds} seconds exceeded`,
      'rate_limited',
      `Retry after ${retryAfterSeconds} seconds`,
    );
  }
}

export class WriteNotAllowedError extends DomainError {
  constructor(reason: string, hint?: string) {
    super(reason, 'write_not_allowed', hint);
  }
}

export class PendingWriteNotFoundError extends DomainError {
  constructor(confirmationId: string) {
    super(
      `No pending write operation found with confirmation_id "${confirmationId}"`,
      'pending_write_not_found',
      'The operation may have expired (pending writes are cancelled after the timeout) or was already resolved',
    );
  }
}
