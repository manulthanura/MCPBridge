/**
 * Platform — composition root: the only place that knows about every feature.
 * Builds the object graph (feature domain services, adapters, use cases)
 * from configuration. Features never import this module.
 */
import { AuditService } from '../../audit/application/AuditService.js';
import { JsonlAuditLogger } from '../../audit/infrastructure/JsonlAuditLogger.js';
import { ConfirmWrite } from '../../guarded-writes/application/ConfirmWrite.js';
import { RejectWrite } from '../../guarded-writes/application/RejectWrite.js';
import { RequestWrite } from '../../guarded-writes/application/RequestWrite.js';
import { RiskAssessor } from '../../guarded-writes/domain/RiskAssessor.js';
import { InMemoryPendingWriteStore } from '../../guarded-writes/infrastructure/InMemoryPendingWriteStore.js';
import { ExecuteQuery } from '../../querying/application/ExecuteQuery.js';
import { ExplainQuery } from '../../querying/application/ExplainQuery.js';
import { QueryValidator } from '../../querying/domain/QueryValidator.js';
import { ResultLimitPolicy } from '../../querying/domain/ResultLimitPolicy.js';
import { DescribeTable } from '../../schema-exploration/application/DescribeTable.js';
import { ListTables } from '../../schema-exploration/application/ListTables.js';
import { SchemaService } from '../../schema-exploration/application/SchemaService.js';
import { PostgresSchemaIntrospector } from '../../schema-exploration/infrastructure/PostgresSchemaIntrospector.js';
import { SearchData } from '../../search/application/SearchData.js';
import { SqlGenerator } from '../../search/application/SqlGenerator.js';
import { UuidGenerator } from '../../shared/infrastructure/UuidGenerator.js';
import { SystemClock } from '../../shared/infrastructure/SystemClock.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { SlidingWindowRateLimiter } from '../../throttling/domain/SlidingWindowRateLimiter.js';
import { AppConfig } from '../config/Config.js';
import { createPool } from '../database/pool.js';
import { PostgresDatabaseGateway } from '../database/PostgresDatabaseGateway.js';

export interface Container {
  config: AppConfig;
  gateway: PostgresDatabaseGateway;
  schemaService: SchemaService;
  useCases: {
    executeQuery: ExecuteQuery;
    explainQuery: ExplainQuery;
    listTables: ListTables;
    describeTable: DescribeTable;
    requestWrite: RequestWrite;
    confirmWrite: ConfirmWrite;
    rejectWrite: RejectWrite;
    searchData: SearchData;
  };
  close(): Promise<void>;
}

/**
 * The SQL generator is created by the MCP layer (it needs the live server
 * for sampling), so it is injected here as a factory argument.
 */
export function buildContainer(config: AppConfig, sqlGenerator: SqlGenerator): Container {
  const clock = new SystemClock();
  const pool = createPool(config);

  // Platform + feature infrastructure adapters
  const gateway = new PostgresDatabaseGateway(pool, config.secrets);
  const introspector = new PostgresSchemaIntrospector(pool, config.secrets, clock);
  const auditLogger = new JsonlAuditLogger(config.auditLogPath, config.secrets);
  const pendingWrites = new InMemoryPendingWriteStore();
  const ids = new UuidGenerator();

  // Feature domain services
  const validator = new QueryValidator({ blockedTables: config.blockedTables });
  const limitPolicy = new ResultLimitPolicy(config.maxRows);
  const riskAssessor = new RiskAssessor({ highRiskRowThreshold: config.highRiskRowThreshold });
  const rateLimiter = new SlidingWindowRateLimiter(clock, config.rateLimit, config.rateWindowMs);

  // Feature application services
  const audit = new AuditService(auditLogger, clock);
  const gate = new OperationGate(rateLimiter, audit);
  const schemaService = new SchemaService(introspector, clock, config.schemaCacheTtlMs);

  return {
    config,
    gateway,
    schemaService,
    useCases: {
      executeQuery: new ExecuteQuery(gate, validator, limitPolicy, gateway, audit),
      explainQuery: new ExplainQuery(gate, validator, gateway, audit),
      listTables: new ListTables(gate, schemaService, audit),
      describeTable: new DescribeTable(gate, schemaService, audit),
      requestWrite: new RequestWrite(gate, validator, gateway, riskAssessor, pendingWrites, ids, clock, audit, {
        readOnlyMode: config.readOnlyMode,
        confirmationTtlMs: config.confirmationTtlMs,
      }),
      confirmWrite: new ConfirmWrite(pendingWrites, gateway, clock, audit, config.confirmationTtlMs),
      rejectWrite: new RejectWrite(pendingWrites, clock, audit, config.confirmationTtlMs),
      searchData: new SearchData(
        gate,
        sqlGenerator,
        schemaService,
        validator,
        limitPolicy,
        gateway,
        audit,
        config.defaultSchema,
      ),
    },
    close: () => gateway.close(),
  };
}
