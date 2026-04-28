import type Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { bugReports, type BugReport } from '../db/schema';
import { AnthropicService } from './anthropic.service';
import type { PolishedTicket } from './ticket-polisher.schema';

const MODEL = 'claude-opus-4-7';

export type TestFramework = 'cypress' | 'playwright';

export interface GeneratedTestStub {
  framework: TestFramework;
  filename: string;
  source: string;
  notes?: string;
}

const TEST_GENERATOR_TOOL: Anthropic.Tool = {
  name: 'submit_test_stub',
  description:
    'Emit the generated test stub. Call exactly once with a runnable file body for the chosen framework.',
  input_schema: {
    type: 'object',
    required: ['filename', 'source'],
    properties: {
      filename: {
        type: 'string',
        minLength: 5,
        maxLength: 120,
        description:
          'Suggested filename, e.g. "login-broken-after-kfz.cy.ts" for Cypress or "login-broken-after-kfz.spec.ts" for Playwright.',
      },
      source: {
        type: 'string',
        minLength: 50,
        description:
          'Full file body as TypeScript. Should be runnable as-is in the project; do not include backticks/markdown fences.',
      },
      notes: {
        type: 'string',
        description: 'Optional one-line note about assumptions or TODOs.',
      },
    },
    additionalProperties: false,
  },
};

@Injectable()
export class TestCaseGeneratorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService
  ) {}

  async generate(reportId: string): Promise<GeneratedTestStub> {
    if (!this.anthropic.isConfigured) {
      throw new ServiceUnavailableException(
        'AI is not configured (set ANTHROPIC_API_KEY)'
      );
    }
    const report = await this.loadReport(reportId);
    const polished = report.aiProposedTicket as PolishedTicket | null;
    if (!polished) {
      throw new NotFoundException(
        `Report ${reportId} has no aiProposedTicket — run /polish first`
      );
    }
    const framework = this.chooseFramework(report.sparte);

    const userPrompt = this.buildPrompt(polished, framework, report);

    const response = await this.anthropic.client.messages.create({
      model: MODEL,
      max_tokens: 3072,
      system: [
        {
          type: 'text',
          text: this.systemPrompt(framework),
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TEST_GENERATOR_TOOL],
      tool_choice: { type: 'tool', name: TEST_GENERATOR_TOOL.name },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === TEST_GENERATOR_TOOL.name
    );
    if (!toolUse) {
      throw new InternalServerErrorException(
        `Generator did not call ${TEST_GENERATOR_TOOL.name}`
      );
    }
    const input = toolUse.input as {
      filename?: string;
      source?: string;
      notes?: string;
    };
    if (!input.filename || !input.source) {
      throw new InternalServerErrorException(
        'Generator returned an incomplete payload'
      );
    }
    const stub: GeneratedTestStub = {
      framework,
      filename: input.filename,
      source: input.source,
      notes: input.notes,
    };

    await this.db
      .update(bugReports)
      .set({
        aiProposedTicket: { ...polished, testStub: stub },
        updatedAt: new Date(),
      })
      .where(eq(bugReports.id, reportId));

    return stub;
  }

  private async loadReport(id: string): Promise<BugReport> {
    const rows = await this.db
      .select()
      .from(bugReports)
      .where(eq(bugReports.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Report ${id} not found`);
    }
    return rows[0];
  }

  private chooseFramework(sparte: string | null): TestFramework {
    const overrideKey = sparte
      ? `TEST_FRAMEWORK_${sparte.toUpperCase()}`
      : null;
    const override = overrideKey
      ? process.env[overrideKey]?.toLowerCase().trim()
      : null;
    if (override === 'playwright' || override === 'cypress') return override;
    const defaultFw =
      process.env['TEST_FRAMEWORK_DEFAULT']?.toLowerCase().trim();
    if (defaultFw === 'playwright') return 'playwright';
    return 'cypress';
  }

  private systemPrompt(framework: TestFramework): string {
    return `You are a senior QA engineer writing an end-to-end test stub for the comparer-ui codebase.

Output a runnable ${framework === 'cypress' ? 'Cypress' : 'Playwright'} test in TypeScript that follows the project conventions:
${framework === 'cypress'
  ? `- Use Cypress 13+ APIs (cy.visit, cy.get, cy.intercept, etc.)
- Filename pattern: <kebab-case>.cy.ts
- Wrap test in describe(...) with one or more it(...) cases
- Add data-cy selectors as TODOs where the component does not yet expose them`
  : `- Use Playwright 1.40+ APIs (test, page.goto, page.locator, etc.)
- Filename pattern: <kebab-case>.spec.ts
- Wrap test in test.describe(...) with test(...) cases`}
- Hardcode no environment values; read URLs from Cypress.env or test config as needed
- Add concise comments only where intent is non-obvious

Return the result via the submit_test_stub tool. Do not include markdown fences in the source field.`;
  }

  private buildPrompt(
    polished: PolishedTicket,
    framework: TestFramework,
    report: BugReport
  ): string {
    return [
      `## Polished ticket`,
      `Title: ${polished.title}`,
      `Type: ${polished.proposedType}`,
      `Labels: ${polished.proposedLabels.join(', ') || '(none)'}`,
      ``,
      `### Description (Markdown)`,
      polished.description,
      ``,
      `### Repro steps`,
      ...polished.repro_steps.map((s, i) => `${i + 1}. ${s}`),
      ``,
      `### Expected`,
      polished.expected,
      ``,
      `### Actual`,
      polished.actual,
      ``,
      `## Context`,
      `Sparte: ${report.sparte ?? '(not set)'}`,
      `Framework: ${framework}`,
      `Captured page context:`,
      `\`\`\`json`,
      JSON.stringify(report.capturedContext ?? null, null, 2),
      `\`\`\``,
      ``,
      `Generate a ${framework} test stub via the submit_test_stub tool.`,
    ].join('\n');
  }
}
