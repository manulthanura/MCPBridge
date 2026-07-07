/**
 * Shared kernel: time abstraction so domain logic involving expiry,
 * rate windows, and cache TTLs stays deterministic and testable.
 */
export interface Clock {
  now(): Date;
}
