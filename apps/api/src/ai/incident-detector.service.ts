import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { cosineDistance, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { bugReports, incidents } from '../db/schema';

const DEFAULT_WINDOW_MINUTES = Number(
  process.env.INCIDENT_WINDOW_MINUTES ?? '60'
);
const DEFAULT_MIN_CLUSTER = Number(
  process.env.INCIDENT_MIN_CLUSTER ?? '3'
);
const DEFAULT_MAX_DISTANCE = Number(
  process.env.INCIDENT_MAX_DISTANCE ?? '0.3'
);

@Injectable()
export class IncidentDetectorService {
  private readonly logger = new Logger('IncidentDetector');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Optional() private readonly realtime?: RealtimeGateway
  ) {}

  async checkAndMaybeOpen(reportId: string): Promise<void> {
    const targetRows = await this.db
      .select()
      .from(bugReports)
      .where(eq(bugReports.id, reportId))
      .limit(1);
    if (targetRows.length === 0) return;
    const target = targetRows[0];
    if (!target.embedding) return;

    const windowStart = new Date(
      Date.now() - DEFAULT_WINDOW_MINUTES * 60 * 1000
    );
    const distance = cosineDistance(bugReports.embedding, target.embedding);

    const neighbors = await this.db
      .select({
        id: bugReports.id,
        title: bugReports.title,
        sparte: bugReports.sparte,
        severity: bugReports.severity,
        clusterId: bugReports.clusterId,
        createdAt: bugReports.createdAt,
        distance: sql<number>`${distance}`.as('distance'),
      })
      .from(bugReports)
      .where(
        sql`${isNotNull(bugReports.embedding)} AND ${gte(bugReports.createdAt, windowStart)}`
      )
      .orderBy(distance)
      .limit(20);

    const cluster = neighbors.filter(
      (n) => n.distance <= DEFAULT_MAX_DISTANCE
    );
    if (cluster.length < DEFAULT_MIN_CLUSTER) return;

    const existingClusterId = cluster.find((c) => c.clusterId)?.clusterId;
    let incidentId: string;
    let isNewIncident = false;

    if (existingClusterId) {
      incidentId = existingClusterId;
    } else {
      const clusterKey = `cluster:${target.id}:${Date.now()}`;
      const [created] = await this.db
        .insert(incidents)
        .values({
          clusterKey,
          summary: {
            firstReportId: cluster[0].id,
            seedTitle: cluster[0].title,
            sparte: target.sparte ?? null,
            initialReportCount: cluster.length,
          },
        })
        .returning();
      incidentId = created.id;
      isNewIncident = true;
    }

    const idsToTag = cluster
      .filter((c) => !c.clusterId)
      .map((c) => c.id);
    if (idsToTag.length > 0) {
      await this.db
        .update(bugReports)
        .set({ clusterId: incidentId, updatedAt: new Date() })
        .where(
          sql`${bugReports.id} IN ${sql.raw(`(${idsToTag.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')})`)}`
        );
    }

    this.logger.log(
      `Cluster ${incidentId}: ${cluster.length} reports, new=${isNewIncident}`
    );

    this.realtime?.emitPatternDetected({
      incidentId,
      isNew: isNewIncident,
      reportIds: cluster.map((c) => c.id),
      sparte: target.sparte ?? null,
      severity: target.severity,
    });
  }
}
