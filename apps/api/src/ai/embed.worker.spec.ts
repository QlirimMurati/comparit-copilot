import type { Job } from 'bullmq';
import type { Database } from '../db/db.module';
import { EmbedWorker } from './embed.worker';
import { EMBED_REPORT_JOB, type EmbedReportJobData } from './embed.queue';
import type { VoyageService } from './voyage.service';

function makeMockDb(reportRows: unknown[], updateMock: jest.Mock) {
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve(reportRows)),
      })),
    })),
  }));
  const update = jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve(updateMock())),
    })),
  }));
  return { select, update } as unknown as Database;
}

const reportRow = {
  id: 'r1',
  title: 'Login button broken',
  description: 'After selecting KFZ tariff, login fails silently',
  severity: 'high' as const,
  sparte: 'kfz' as const,
  capturedContext: { url: 'https://example.test/dashboard' },
};

describe('EmbedWorker.embedReport', () => {
  const mockVoyage = {
    isConfigured: true,
    embedText: jest.fn(),
  } as unknown as VoyageService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockVoyage.embedText as jest.Mock).mockResolvedValue(
      Array.from({ length: 1024 }, () => 0.5)
    );
  });

  it('embeds the report text and writes the vector to the row', async () => {
    const updateMock = jest.fn();
    const db = makeMockDb([reportRow], updateMock);
    const worker = new EmbedWorker(db, mockVoyage);

    const job = {
      id: '1',
      name: EMBED_REPORT_JOB,
      data: { reportId: 'r1' } as EmbedReportJobData,
    } as Job<EmbedReportJobData>;

    await worker.embedReport(job);

    expect(mockVoyage.embedText).toHaveBeenCalledTimes(1);
    const [text, type] = (mockVoyage.embedText as jest.Mock).mock.calls[0];
    expect(text).toContain('Title: Login button broken');
    expect(text).toContain('Sparte: kfz');
    expect(text).toContain('Description:');
    expect(type).toBe('document');
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('skips quietly when the report no longer exists', async () => {
    const updateMock = jest.fn();
    const db = makeMockDb([], updateMock);
    const worker = new EmbedWorker(db, mockVoyage);

    const job = {
      id: '1',
      name: EMBED_REPORT_JOB,
      data: { reportId: 'missing' } as EmbedReportJobData,
    } as Job<EmbedReportJobData>;

    await worker.embedReport(job);

    expect(mockVoyage.embedText).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
