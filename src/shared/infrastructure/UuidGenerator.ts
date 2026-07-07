import { randomUUID } from 'node:crypto';
import { IdGenerator } from '../application/IdGenerator.js';

export class UuidGenerator implements IdGenerator {
  nextId(): string {
    return randomUUID();
  }
}
