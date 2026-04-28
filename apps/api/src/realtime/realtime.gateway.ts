import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import type { JwtPayload } from '../auth/auth.types';

export interface BugReportEventPayload {
  reportId: string;
  reporterId?: string;
  status?: string;
  severity?: string;
  sparte?: string | null;
}

export interface AiProposalEventPayload {
  reportId: string;
  kind: 'polished_ticket' | 'triage' | 'duplicates';
}

export interface TranscriptNodeEventPayload {
  sessionId: string;
  nodeId: string;
  parentId: string | null;
  nodeType: 'epic' | 'story' | 'subtask';
  title: string;
}

export interface JiraSyncEventPayload {
  reportId?: string;
  jiraIssueKey?: string;
  status?: string;
}

export interface PatternDetectedEventPayload {
  incidentId: string;
  isNew: boolean;
  reportIds: string[];
  sparte: string | null;
  severity: string;
}

@Injectable()
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/realtime',
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger('RealtimeGateway');

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService
  ) {}

  afterInit(): void {
    this.logger.log("WebSocket gateway initialised at namespace '/realtime'");
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const userId = await this.authenticate(client);
      if (userId) {
        client.join(`user:${userId}`);
        client.data.userId = userId;
        this.logger.log(`user ${userId} connected (${client.id})`);
      } else {
        client.data.widget = true;
        this.logger.log(`widget client connected (${client.id})`);
      }
    } catch (err) {
      this.logger.warn(
        `connection rejected (${client.id}): ${(err as Error).message}`
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`disconnected (${client.id})`);
  }

  emitBugReportCreated(payload: BugReportEventPayload): void {
    if (!this.server) return;
    this.server.emit('bug_report.created', payload);
    this.server.to(`report:${payload.reportId}`).emit('report.update', payload);
    if (payload.reporterId) {
      this.server
        .to(`user:${payload.reporterId}`)
        .emit('user.bug_report.created', payload);
    }
  }

  emitAiProposalReady(payload: AiProposalEventPayload): void {
    if (!this.server) return;
    this.server.to(`report:${payload.reportId}`).emit('ai.proposal_ready', payload);
  }

  emitJiraSync(payload: JiraSyncEventPayload): void {
    if (!this.server) return;
    if (payload.reportId) {
      this.server.to(`report:${payload.reportId}`).emit('jira.sync', payload);
    } else {
      this.server.emit('jira.sync', payload);
    }
  }

  emitTranscriptNodeAdded(payload: TranscriptNodeEventPayload): void {
    if (!this.server) return;
    this.server
      .to(`transcript:${payload.sessionId}`)
      .emit('transcript.node_added', payload);
  }

  emitPatternDetected(payload: PatternDetectedEventPayload): void {
    if (!this.server) return;
    this.server.emit('pattern.detected', payload);
  }

  /**
   * Subscribe a client to a per-resource room. Called by client emit('subscribe', {...}).
   */
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  private handleSubscribe(_client: Socket, _channel: string): void {
    // For now, allow any authenticated client to subscribe to any channel —
    // tighten authorization later if/when channels carry sensitive data.
  }

  private async authenticate(client: Socket): Promise<string | null> {
    const token = extractBearer(client);
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        const user = await this.auth.findById(payload.sub);
        if (user) return user.id;
      } catch {
        throw new Error('Invalid bearer token');
      }
    }

    const basic = extractBasic(client);
    if (basic) {
      const expectedUser = process.env.WIDGET_BASIC_USER ?? 'widget';
      const expectedPass = process.env.WIDGET_BASIC_PASS ?? 'local';
      if (basic.user === expectedUser && basic.pass === expectedPass) {
        return null; // widget — no user binding
      }
      throw new Error('Invalid widget credentials');
    }

    throw new Error('Missing auth (Bearer or Basic)');
  }
}

function extractBearer(client: Socket): string | null {
  const authStr = (client.handshake.auth?.token ??
    client.handshake.headers.authorization) as string | undefined;
  if (!authStr) return null;
  if (authStr.startsWith('Bearer ')) return authStr.slice(7);
  return null;
}

function extractBasic(client: Socket): { user: string; pass: string } | null {
  const header = client.handshake.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}
