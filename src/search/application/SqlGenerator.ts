/**
 * Application port: natural language → SQL. The production implementation
 * uses MCP sampling (asks the connected client's LLM); tests use a stub.
 */

export class SqlGenerationUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SqlGenerationUnavailableError';
  }
}

export interface SqlGenerator {
  /**
   * Produces a single read-only PostgreSQL statement answering `question`,
   * given a compact description of the schema.
   */
  generateSql(question: string, schemaContext: string): Promise<string>;
}
