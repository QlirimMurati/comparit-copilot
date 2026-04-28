import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AnthropicService } from './anthropic.service';
import type { ChatSessionService } from './chat-session.service';
import type { Database } from '../db/db.module';
import { TicketPolisherService } from './ticket-polisher.service';
import { PolishedTicketSchema } from './ticket-polisher.schema';

const validPayload = {
  title: 'Login button does nothing on dashboard after KFZ tariff selection',
  description:
    '## Summary\nClicking the primary login button on the dashboard fails silently after the user selects a KFZ tariff.\n\n## Steps\n1. Open dashboard\n2. Pick a KFZ tariff\n3. Click login\n\n## Expected\nLogin succeeds.\n\n## Actual\nNothing happens.',
  proposedType: 'bug' as const,
  proposedLabels: ['kfz', 'frontend'],
  repro_steps: [
    'Open the dashboard',
    'Select a KFZ tariff',
    'Click the login button',
  ],
  expected: 'The login flow opens.',
  actual: 'Nothing happens — no error, no navigation.',
};

const reportRow = {
  id: 'report-1',
  reporterId: 'user-1',
  title: 'login button broken',
  description: 'click does nothing',
  status: 'new' as const,
  severity: 'high' as const,
  sparte: 'kfz' as const,
  capturedContext: { url: 'https://example.test/dashboard' },
  aiProposedTicket: null,
  jiraIssueKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockDb(opts: {
  reportRows: unknown[];
  sessionRows: unknown[];
  updateMock: jest.Mock;
}) {
  const selectQueue = [opts.reportRows, opts.sessionRows];
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      })),
    })),
  }));
  const update = jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve(opts.updateMock())),
    })),
  }));
  return { select, update } as unknown as Database;
}

describe('TicketPolisherService.polish', () => {
  const mockMessagesCreate = jest.fn();
  const mockClient = { messages: { create: mockMessagesCreate } };
  const mockAnthropic = {
    isConfigured: true,
    client: mockClient,
  } as unknown as AnthropicService;

  const mockSessions = {
    listMessages: jest.fn(),
  } as unknown as ChatSessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockSessions.listMessages as jest.Mock).mockResolvedValue([]);
  });

  it('persists and returns a validated polished ticket on the happy path', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'submit_polished_ticket',
          input: validPayload,
        },
      ],
    });
    const updateMock = jest.fn().mockReturnValue(undefined);
    const db = makeMockDb({
      reportRows: [reportRow],
      sessionRows: [{ id: 'session-1' }],
      updateMock,
    });

    const svc = new TicketPolisherService(db, mockAnthropic, mockSessions);
    const result = await svc.polish('report-1');

    expect(result).toEqual(validPayload);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockMessagesCreate.mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({
      type: 'tool',
      name: 'submit_polished_ticket',
    });
  });

  it('throws NotFound when the report does not exist', async () => {
    const db = makeMockDb({
      reportRows: [],
      sessionRows: [],
      updateMock: jest.fn(),
    });
    const svc = new TicketPolisherService(db, mockAnthropic, mockSessions);

    await expect(svc.polish('missing')).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('polishes from report fields alone when no chat session is linked', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'submit_polished_ticket',
          input: validPayload,
        },
      ],
    });
    const updateMock = jest.fn().mockReturnValue(undefined);
    const db = makeMockDb({
      reportRows: [reportRow],
      sessionRows: [],
      updateMock,
    });

    const svc = new TicketPolisherService(db, mockAnthropic, mockSessions);
    const result = await svc.polish('report-1');

    expect(result).toEqual(validPayload);
    expect(mockSessions.listMessages).not.toHaveBeenCalled();
  });

  it('throws when the model returns an invalid payload', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'submit_polished_ticket',
          input: { title: 'too short' },
        },
      ],
    });
    const db = makeMockDb({
      reportRows: [reportRow],
      sessionRows: [],
      updateMock: jest.fn(),
    });

    const svc = new TicketPolisherService(db, mockAnthropic, mockSessions);
    await expect(svc.polish('report-1')).rejects.toBeInstanceOf(
      InternalServerErrorException
    );
  });

  it('throws when ANTHROPIC_API_KEY is not configured', async () => {
    const unconfigured = {
      isConfigured: false,
    } as unknown as AnthropicService;
    const db = makeMockDb({
      reportRows: [],
      sessionRows: [],
      updateMock: jest.fn(),
    });

    const svc = new TicketPolisherService(db, unconfigured, mockSessions);
    await expect(svc.polish('any')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });
});

describe('PolishedTicketSchema', () => {
  it('accepts a valid payload', () => {
    expect(PolishedTicketSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects when required fields are missing', () => {
    expect(
      PolishedTicketSchema.safeParse({ ...validPayload, repro_steps: [] }).success
    ).toBe(false);
    expect(
      PolishedTicketSchema.safeParse({ ...validPayload, title: 'x' }).success
    ).toBe(false);
  });
});
