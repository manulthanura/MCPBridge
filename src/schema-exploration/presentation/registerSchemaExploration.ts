/**
 * Schema-exploration feature — presentation: the list_tables / describe_table
 * tools, the browsable MCP resources, and the analyze-table prompt.
 *
 *   schema://{schemaName}   full schema snapshot (tables, columns, keys)
 *   table://{name}          one table's structure
 *   stats://{table}         size / vacuum / column statistics
 *   relations://{table}     foreign-key relationship map
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { clientIdOf } from '../../shared/presentation/client-id.js';
import {
  errorResponse,
  markdownTable,
  textResponse,
  ToolResponse,
} from '../../shared/presentation/formatting.js';
import { DescribeTable } from '../application/DescribeTable.js';
import { ListTables } from '../application/ListTables.js';
import { SchemaService } from '../application/SchemaService.js';

export interface SchemaExplorationDeps {
  listTables: ListTables;
  describeTable: DescribeTable;
  schemaService: SchemaService;
  defaultSchema: string;
}

export function registerSchemaExploration(server: McpServer, deps: SchemaExplorationDeps): void {
  registerSchemaTools(server, deps);
  registerSchemaResources(server, deps);
  registerSchemaPrompts(server, deps);
}

function registerSchemaTools(server: McpServer, deps: SchemaExplorationDeps): void {
  server.registerTool(
    'list_tables',
    {
      title: 'List tables',
      description:
        'List all tables and views in a schema with estimated row counts and descriptions.',
      inputSchema: {
        schema: z.string().optional().describe(`Schema name (default "${deps.defaultSchema}")`),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ schema }): Promise<ToolResponse> => {
      const result = await deps.listTables.execute({
        schema: schema ?? deps.defaultSchema,
        clientId: clientIdOf(server),
      });
      if (!result.ok) return errorResponse(result.error);
      const rows = result.value.map((t) => ({
        table: t.name,
        kind: t.kind,
        estimated_rows: t.estimatedRows.toLocaleString('en-US'),
        description: t.description ?? '',
      }));
      return textResponse(markdownTable(['table', 'kind', 'estimated_rows', 'description'], rows));
    },
  );

  server.registerTool(
    'describe_table',
    {
      title: 'Describe table',
      description:
        'Full description of one table: columns, primary key, foreign keys, indexes, ' +
        'relationships, sample rows and column statistics.',
      inputSchema: {
        table: z.string().describe('Table name'),
        schema: z.string().optional().describe(`Schema name (default "${deps.defaultSchema}")`),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ table, schema }): Promise<ToolResponse> => {
      const result = await deps.describeTable.execute({
        table,
        schema: schema ?? deps.defaultSchema,
        clientId: clientIdOf(server),
      });
      if (!result.ok) return errorResponse(result.error);
      const { details, relationships, sampleRows, columnStats } = result.value;

      const parts: string[] = [
        `# ${details.schema}.${details.name} (${details.kind}, ~${details.estimatedRows.toLocaleString('en-US')} rows)`,
      ];
      if (details.description) parts.push(details.description);

      parts.push('\n## Columns');
      parts.push(
        markdownTable(
          ['column', 'type', 'nullable', 'default', 'key'],
          details.columns.map((c) => ({
            column: c.name,
            type: c.dataType,
            nullable: c.nullable ? 'yes' : 'no',
            default: c.defaultValue ?? '',
            key: c.isPrimaryKey ? 'PK' : '',
          })),
        ),
      );

      if (details.foreignKeys.length > 0) {
        parts.push('\n## Foreign keys');
        parts.push(
          details.foreignKeys
            .map(
              (fk) =>
                `- ${fk.column} → ${fk.referencesTable}.${fk.referencesColumn} (${fk.constraintName})`,
            )
            .join('\n'),
        );
      }

      if (details.indexes.length > 0) {
        parts.push('\n## Indexes');
        parts.push(
          details.indexes.map((ix) => `- ${ix.name}${ix.isUnique ? ' (unique)' : ''}`).join('\n'),
        );
      }

      if (relationships.length > 0) {
        parts.push('\n## Relationships');
        parts.push(
          markdownTable(
            ['relationship', 'cardinality', 'via'],
            relationships.map((r) => ({
              relationship: `${r.fromTable} → ${r.toTable}`,
              cardinality: r.cardinality,
              via: r.viaColumn,
            })),
          ),
        );
      }

      if (sampleRows.length > 0) {
        parts.push('\n## Sample rows');
        parts.push(markdownTable([], sampleRows));
      }

      if (columnStats.length > 0) {
        parts.push('\n## Column statistics');
        parts.push(
          markdownTable(
            ['column', 'null_fraction', 'distinct_values'],
            columnStats.map((s) => ({
              column: s.column,
              null_fraction: s.nullFraction ?? 'n/a',
              distinct_values: s.distinctValues ?? 'n/a',
            })),
          ),
        );
      }

      return textResponse(parts.join('\n'));
    },
  );
}

function registerSchemaResources(server: McpServer, deps: SchemaExplorationDeps): void {
  const { schemaService, defaultSchema } = deps;

  const listTableResources = async (scheme: string) => {
    const tables = await schemaService.listTables(defaultSchema);
    return {
      resources: tables.map((t) => ({
        uri: `${scheme}://${t.name}`,
        name: `${scheme}: ${t.name}`,
        description: t.description ?? `${t.kind} with ~${t.estimatedRows} rows`,
        mimeType: 'application/json',
      })),
    };
  };

  server.registerResource(
    'schema',
    new ResourceTemplate('schema://{schemaName}', {
      list: async () => ({
        resources: [
          {
            uri: `schema://${defaultSchema}`,
            name: `Database schema: ${defaultSchema}`,
            description: 'Complete schema snapshot: tables, columns, keys, indexes',
            mimeType: 'application/json',
          },
        ],
      }),
    }),
    {
      title: 'Database schema',
      description: 'Complete schema description for a PostgreSQL schema (cached, 5-minute TTL)',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const schemaName = str(variables.schemaName) || defaultSchema;
      const snapshot = await schemaService.getSchemaSnapshot(schemaName);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(snapshot, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'table',
    new ResourceTemplate('table://{name}', { list: () => listTableResources('table') }),
    {
      title: 'Table structure',
      description: 'Columns, keys and indexes for one table',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const table = str(variables.name);
      const details = await schemaService.describeTable(defaultSchema, table);
      if (!details) throw new Error(`Table "${defaultSchema}.${table}" does not exist`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(details, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'stats',
    new ResourceTemplate('stats://{table}', { list: () => listTableResources('stats') }),
    {
      title: 'Table statistics',
      description: 'Row estimates, sizes, vacuum/analyze recency and column statistics',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const table = str(variables.table);
      const stats = await schemaService.getTableStatistics(defaultSchema, table);
      if (!stats) throw new Error(`No statistics available for "${defaultSchema}.${table}"`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'relations',
    new ResourceTemplate('relations://{table}', { list: () => listTableResources('relations') }),
    {
      title: 'Table relationships',
      description: 'Foreign-key relationships (incoming and outgoing) with cardinality',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const table = str(variables.table);
      const relationships = await schemaService.getRelationships(defaultSchema, table);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ table, relationships }, null, 2),
          },
        ],
      };
    },
  );
}

function registerSchemaPrompts(server: McpServer, deps: SchemaExplorationDeps): void {
  server.registerPrompt(
    'analyze-table',
    {
      title: 'Analyze a table',
      description: 'Guided analysis of one table: structure, data quality, and insights',
      argsSchema: {
        table: z.string().describe('Table to analyze'),
      },
    },
    ({ table }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Analyze the "${table}" table in the "${deps.defaultSchema}" schema:`,
              '',
              `1. Call describe_table with table="${table}" to understand its structure.`,
              '2. Review the columns, keys, relationships and sample rows.',
              '3. Use query_db to check data quality: null rates in important columns, duplicates, outliers.',
              '4. Summarize: what the table stores, how it connects to other tables, data quality issues, and anything surprising.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}

function str(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
