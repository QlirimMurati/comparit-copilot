import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmbedQueueService } from '../ai/embed.queue';
import { TriageQueueService } from '../ai/triage.queue';
import { DRIZZLE } from '../db/db.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WidgetService } from './widget.service';

jest.mock('../users/find-or-create-reporter', () => ({
  findOrCreateReporter: jest.fn().mockResolvedValue('reporter-uuid'),
}));

function makeDb(returnRow: Record<string, unknown>) {
  const returning = jest.fn().mockResolvedValue([returnRow]);
  const values = jest.fn().mockReturnValue({ returning });
  const insert = jest.fn().mockReturnValue({ values });
  return { db: { insert }, insert, values, returning };
}

function buildModule(db: unknown, extras: { enqueueEmb?: jest.Mock; enqueueTri?: jest.Mock; emit?: jest.Mock } = {}) {
  return Test.createTestingModule({
    providers: [
      WidgetService,
      { provide: DRIZZLE, useValue: db },
      {
        provide: EmbedQueueService,
        useValue: { enqueueReportEmbedding: extras.enqueueEmb ?? jest.fn() },
      },
      {
        provide: TriageQueueService,
        useValue: { enqueueReportTriage: extras.enqueueTri ?? jest.fn() },
      },
      {
        provide: RealtimeGateway,
        useValue: { emitBugReportCreated: extras.emit ?? jest.fn() },
      },
    ],
  }).compile();
}

describe('WidgetService.submit', () => {
  const baseInput = {
    title: 'broken submit button',
    description: 'pressing submit does nothing on the bu form',
    reporterEmail: 'qa@comparit.de',
  } as const;

  it('rejects missing reporterEmail', async () => {
    const { db } = makeDb({});
    const module = await buildModule(db);
    const svc = module.get(WidgetService);
    await expect(
      svc.submit({ ...baseInput, reporterEmail: '' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects too-short title', async () => {
    const { db } = makeDb({});
    const module = await buildModule(db);
    const svc = module.get(WidgetService);
    await expect(svc.submit({ ...baseInput, title: 'no' })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects too-short description', async () => {
    const { db } = makeDb({});
    const module = await buildModule(db);
    const svc = module.get(WidgetService);
    await expect(
      svc.submit({ ...baseInput, description: 'short' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inserts, enqueues embedding + triage, emits realtime, returns shaped result', async () => {
    const createdAt = new Date('2026-01-15T10:00:00Z');
    const { db, insert, values, returning } = makeDb({
      id: 'report-1',
      status: 'open',
      createdAt,
    });
    const enqueueEmb = jest.fn();
    const enqueueTri = jest.fn();
    const emit = jest.fn();
    const module = await buildModule(db, { enqueueEmb, enqueueTri, emit });
    const svc = module.get(WidgetService);

    const result = await svc.submit({
      ...baseInput,
      severity: 'high',
      sparte: 'bu',
    });

    expect(result).toEqual({
      id: 'report-1',
      status: 'open',
      createdAt: createdAt.toISOString(),
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: 'reporter-uuid',
        title: 'broken submit button',
        severity: 'high',
        sparte: 'bu',
      })
    );
    expect(returning).toHaveBeenCalled();
    expect(enqueueEmb).toHaveBeenCalledWith('report-1');
    expect(enqueueTri).toHaveBeenCalledWith('report-1');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'report-1',
        severity: 'high',
        sparte: 'bu',
      })
    );
  });
});
