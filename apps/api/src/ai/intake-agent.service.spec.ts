import type { AnthropicService } from './anthropic.service';
import type { ChatSessionService } from './chat-session.service';
import { IntakeAgentService } from './intake-agent.service';
import type { IntakeStreamEvent } from './intake.types';

type StreamEvent = {
  type: string;
  delta?: { type: string; text?: string };
};

function makeStream(events: StreamEvent[], final: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    finalMessage: async () => final,
  };
}

describe('IntakeAgentService.runTurnStream', () => {
  const mockStream = jest.fn();
  const mockClient = { messages: { stream: mockStream } };
  const mockAnthropic = {
    isConfigured: true,
    client: mockClient,
  } as unknown as AnthropicService;

  const mockSessions = {
    getById: jest.fn(),
    listMessages: jest.fn(),
    appendMessage: jest.fn(),
    setIntakeState: jest.fn(),
  } as unknown as ChatSessionService;

  let service: IntakeAgentService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockSessions.getById as jest.Mock).mockResolvedValue({
      id: 's1',
      intakeState: { isComplete: false },
      capturedContext: {},
    });
    (mockSessions.listMessages as jest.Mock).mockResolvedValue([]);
    (mockSessions.appendMessage as jest.Mock).mockResolvedValue({});
    (mockSessions.setIntakeState as jest.Mock).mockResolvedValue({});
    service = new IntakeAgentService(mockAnthropic, mockSessions);
  });

  it('forwards text deltas and emits state + done on end_turn', async () => {
    mockStream.mockReturnValueOnce(
      makeStream(
        [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } },
        ],
        {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Hi there' }],
          usage: { input_tokens: 10, output_tokens: 4 },
        }
      )
    );

    const events: IntakeStreamEvent[] = [];
    for await (const e of service.runTurnStream({
      sessionId: 's1',
      userText: 'hello',
    })) {
      events.push(e);
    }

    const deltas = events.filter(
      (e): e is Extract<IntakeStreamEvent, { type: 'text_delta' }> =>
        e.type === 'text_delta'
    );
    expect(deltas.map((e) => e.text)).toEqual(['Hi ', 'there']);

    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'done', stopReason: 'end_turn' });

    const stateEvent = events.find((e) => e.type === 'state');
    expect(stateEvent).toEqual({
      type: 'state',
      intakeState: { isComplete: false },
      isComplete: false,
    });

    expect(mockSessions.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'hello' })
    );
    expect(mockSessions.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', stopReason: 'end_turn' })
    );
    expect(mockSessions.setIntakeState).toHaveBeenCalledTimes(1);
  });

  it('runs tool loop: applies update_intake then streams the follow-up turn', async () => {
    mockStream
      .mockReturnValueOnce(
        makeStream([], {
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'update_intake',
              input: { title: 'Login button broken on dashboard' },
            },
          ],
          usage: { input_tokens: 20, output_tokens: 5 },
        })
      )
      .mockReturnValueOnce(
        makeStream(
          [
            {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Got it.' },
            },
          ],
          {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Got it.' }],
            usage: { input_tokens: 25, output_tokens: 3 },
          }
        )
      );

    const events: IntakeStreamEvent[] = [];
    for await (const e of service.runTurnStream({
      sessionId: 's1',
      userText: 'the login button is broken',
    })) {
      events.push(e);
    }

    expect(mockStream).toHaveBeenCalledTimes(2);
    const stateEvent = events.find((e) => e.type === 'state') as Extract<
      IntakeStreamEvent,
      { type: 'state' }
    >;
    expect(stateEvent.intakeState.title).toBe('Login button broken on dashboard');
  });

  it('emits unconfigured done event when ANTHROPIC_API_KEY is not set', async () => {
    const unconfigured = { isConfigured: false } as unknown as AnthropicService;
    const svc = new IntakeAgentService(unconfigured, mockSessions);

    const events: IntakeStreamEvent[] = [];
    for await (const e of svc.runTurnStream({ sessionId: 's1' })) {
      events.push(e);
    }

    expect(events[0].type).toBe('text_delta');
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      stopReason: 'unconfigured',
    });
    expect(mockStream).not.toHaveBeenCalled();
  });
});
