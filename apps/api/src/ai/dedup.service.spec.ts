import { ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '../db/db.module';
import { DedupService } from './dedup.service';
import type { VoyageService } from './voyage.service';

function makeMockDb(rows: unknown[]) {
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(rows)),
        })),
      })),
    })),
  }));
  return { select } as unknown as Database;
}

describe('DedupService.checkDuplicate', () => {
  const mockVoyage = {
    isConfigured: true,
    embedText: jest.fn(),
  } as unknown as VoyageService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockVoyage.embedText as jest.Mock).mockResolvedValue(
      Array.from({ length: 1024 }, () => 0.1)
    );
  });

  it('throws ServiceUnavailable when Voyage is not configured', async () => {
    const db = makeMockDb([]);
    const svc = new DedupService(db, {
      isConfigured: false,
      embedText: jest.fn(),
    } as unknown as VoyageService);
    await expect(
      svc.checkDuplicate({ title: 'x', description: 'y' })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns candidates filtered by maxDistance, mapped to API shape', async () => {
    const createdAt = new Date('2026-04-28T08:00:00Z');
    const db = makeMockDb([
      {
        id: 'r1',
        title: 'Login button broken',
        status: 'new',
        severity: 'high',
        sparte: 'kfz',
        jiraIssueKey: null,
        createdAt,
        distance: 0.12,
      },
      {
        id: 'r2',
        title: 'Unrelated issue',
        status: 'resolved',
        severity: 'low',
        sparte: null,
        jiraIssueKey: 'JIRA-1',
        createdAt,
        distance: 0.45, // above default ceiling 0.35 — should be filtered
      },
    ]);
    const svc = new DedupService(db, mockVoyage);

    const result = await svc.checkDuplicate({
      title: 'login broken',
      description: 'cannot log in after selecting kfz',
      sparte: 'kfz',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'r1',
      title: 'Login button broken',
      status: 'new',
      severity: 'high',
      sparte: 'kfz',
      jiraIssueKey: null,
      createdAt: createdAt.toISOString(),
      distance: 0.12,
    });
    expect(mockVoyage.embedText).toHaveBeenCalledWith(
      expect.stringContaining('Sparte: kfz'),
      'query'
    );
  });

  it('respects custom limit and maxDistance', async () => {
    const createdAt = new Date();
    const db = makeMockDb([
      { id: 'a', title: 'a', status: 'new', severity: 'low', sparte: null, jiraIssueKey: null, createdAt, distance: 0.5 },
      { id: 'b', title: 'b', status: 'new', severity: 'low', sparte: null, jiraIssueKey: null, createdAt, distance: 0.6 },
    ]);
    const svc = new DedupService(db, mockVoyage);

    const result = await svc.checkDuplicate({
      title: 'foo',
      description: 'bar baz',
      maxDistance: 0.55,
    });

    expect(result.map((r) => r.id)).toEqual(['a']);
  });
});
