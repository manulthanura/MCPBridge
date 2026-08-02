/**
 * Use case: detect_anomalies — runs the anomaly detector over a recent
 * window of the audit trail. Pipeline: rate gate → read trail → detect →
 * audit. Diagnostic and read-only: it never touches the database.
 */
import { AnomalyDetector } from '../domain/AnomalyDetector.js';
import { Anomaly } from '../domain/Anomaly.js';
import { AuditReader } from './AuditReader.js';
import { AuditService } from './AuditService.js';
import { Clock } from '../../shared/domain/Clock.js';
import { OperationGate } from '../../throttling/application/OperationGate.js';
import { err, ok, UseCaseResult } from '../../shared/application/result.js';

export interface DetectAnomaliesInput {
  /** How far back to look, in minutes. Defaults to 60. */
  lookbackMinutes?: number;
  clientId: string;
}

export interface DetectAnomaliesOutput {
  entriesAnalyzed: number;
  windowMinutes: number;
  anomalies: Anomaly[];
}

const TOOL = 'detect_anomalies';

export class DetectAnomalies {
  constructor(
    private readonly gate: OperationGate,
    private readonly reader: AuditReader,
    private readonly detector: AnomalyDetector,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async execute(input: DetectAnomaliesInput): Promise<UseCaseResult<DetectAnomaliesOutput>> {
    const gate = await this.gate.pass(TOOL, input.clientId);
    if (!gate.ok) return err(gate.error);

    const windowMinutes = input.lookbackMinutes ?? 60;
    const since = new Date(this.clock.now().getTime() - windowMinutes * 60_000);

    try {
      const entries = await this.reader.readSince(since);
      const anomalies = this.detector.detect(entries);

      await this.audit.record({
        tool: TOOL,
        clientId: input.clientId,
        status: 'success',
        detail: `analyzed ${entries.length} entries over ${windowMinutes}m, ${anomalies.length} anomaly(ies) flagged`,
      });

      return ok({ entriesAnalyzed: entries.length, windowMinutes, anomalies });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await this.audit.record({ tool: TOOL, clientId: input.clientId, status: 'error', detail: reason });
      return err({ code: 'internal_error', reason });
    }
  }
}
