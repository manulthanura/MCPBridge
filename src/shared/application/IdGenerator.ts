/**
 * Application port: opaque unique ids (confirmation ids). Infrastructure
 * uses crypto.randomUUID; tests use a sequence.
 */
export interface IdGenerator {
  nextId(): string;
}
