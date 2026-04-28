import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database } from '../db/db.module';
import type { JiraClient } from './jira.client';
import { JqlBuilderService } from './jql-builder.service';
import { PushToJiraService } from './push-to-jira.service';
import type { TicketsCacheService } from './tickets-cache.service';

const baseReport = {
  id: 'report-1',
  reporterId: 'user-1',
  title: 'Login button broken on KFZ dashboard',
  description: 'After picking KFZ tariff, login click is silent.',
  status: 'new' as const,
  severity: 'high' as const,
  sparte: 'kfz' as const,
  capturedContext: { url: 'https://example.test/dashboard' },
  aiProposedTicket: null,
  aiProposedTriage: null,
  clusterId: null,
  embedding: null,
  jiraIssueKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockDb(opts: {
  reportRows: unknown[];
  updateMock?: jest.Mock;
}) {
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve(opts.reportRows)),
      })),
    })),
  }));
  const update = jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve(opts.updateMock ? opts.updateMock() : undefined)),
    })),
  }));
  return { select, update } as unknown as Database;
}

const cacheStub = {
  upsertFromRaw: jest.fn().mockResolvedValue({}),
  findByKey: jest.fn(),
} as unknown as TicketsCacheService;

describe('PushToJiraService', () => {
  let jql: JqlBuilderService;
  const originalAllowed = process.env.JIRA_ALLOWED_PROJECTS;
  const originalDefault = process.env.JIRA_DEFAULT_PROJECT;
  const originalIssueType = process.env.JIRA_DEFAULT_ISSUE_TYPE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JIRA_ALLOWED_PROJECTS = 'LV';
    process.env.JIRA_DEFAULT_PROJECT = 'LV';
    process.env.JIRA_DEFAULT_ISSUE_TYPE = 'Bug';
    process.env.JIRA_BASE_URL = 'https://comparit.atlassian.net';
    jql = new JqlBuilderService();
  });

  afterEach(() => {
    if (originalAllowed === undefined) delete process.env.JIRA_ALLOWED_PROJECTS;
    else process.env.JIRA_ALLOWED_PROJECTS = originalAllowed;
    if (originalDefault === undefined) delete process.env.JIRA_DEFAULT_PROJECT;
    else process.env.JIRA_DEFAULT_PROJECT = originalDefault;
    if (originalIssueType === undefined) delete process.env.JIRA_DEFAULT_ISSUE_TYPE;
    else process.env.JIRA_DEFAULT_ISSUE_TYPE = originalIssueType;
  });

  it('refuses to preview when Jira is not configured', async () => {
    const db = makeMockDb({ reportRows: [baseReport] });
    const client = { isConfigured: false } as unknown as JiraClient;
    const svc = new PushToJiraService(db, client, jql, cacheStub);
    await expect(svc.preview('report-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it('returns a preview with stable hash and report-derived payload', async () => {
    const db = makeMockDb({ reportRows: [baseReport] });
    const client = { isConfigured: true } as unknown as JiraClient;
    const svc = new PushToJiraService(db, client, jql, cacheStub);

    const preview = await svc.preview('report-1');
    expect(preview.projectKey).toBe('LV');
    expect(preview.issueType).toBe('Bug');
    expect(preview.summary).toBe(baseReport.title);
    expect(preview.description).toContain(baseReport.description);
    expect(preview.description).toContain('Filed via Comparit Copilot');
    expect(preview.labels).toContain('kfz');
    expect(preview.labels).toContain('comparit-copilot');
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);

    const again = await svc.preview('report-1');
    expect(again.previewHash).toBe(preview.previewHash);
  });

  it('refuses to push if the report is already linked to a Jira issue', async () => {
    const db = makeMockDb({
      reportRows: [{ ...baseReport, jiraIssueKey: 'LV-1234' }],
    });
    const client = { isConfigured: true } as unknown as JiraClient;
    const svc = new PushToJiraService(db, client, jql, cacheStub);
    await expect(svc.preview('report-1')).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('refuses confirm when previewHash is missing or wrong', async () => {
    const db = makeMockDb({ reportRows: [baseReport] });
    const client = {
      isConfigured: true,
      createIssue: jest.fn(),
      getIssue: jest.fn(),
    } as unknown as JiraClient;
    const svc = new PushToJiraService(db, client, jql, cacheStub);

    await expect(svc.confirm('report-1', { previewHash: '' })).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(
      svc.confirm('report-1', { previewHash: 'a'.repeat(64) })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((client as unknown as { createIssue: jest.Mock }).createIssue).not.toHaveBeenCalled();
  });

  it('creates the Jira issue and persists the key when previewHash matches', async () => {
    const updateMock = jest.fn();
    const db = makeMockDb({
      reportRows: [baseReport],
      updateMock,
    });
    const createIssue = jest
      .fn()
      .mockResolvedValue({ id: '10001', key: 'LV-9999', self: 'https://x' });
    const getIssue = jest.fn().mockResolvedValue({ key: 'LV-9999', fields: {} });
    const client = {
      isConfigured: true,
      createIssue,
      getIssue,
    } as unknown as JiraClient;

    const svc = new PushToJiraService(db, client, jql, cacheStub);
    const preview = await svc.preview('report-1');
    const result = await svc.confirm('report-1', { previewHash: preview.previewHash });

    expect(result.jiraIssueKey).toBe('LV-9999');
    expect(result.jiraIssueUrl).toBe(
      'https://comparit.atlassian.net/browse/LV-9999'
    );
    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('throws NotFound when report does not exist', async () => {
    const db = makeMockDb({ reportRows: [] });
    const client = { isConfigured: true } as unknown as JiraClient;
    const svc = new PushToJiraService(db, client, jql, cacheStub);
    await expect(svc.preview('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
