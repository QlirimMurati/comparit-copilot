import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * Thin wrapper around the Atlassian Jira Cloud REST API v3.
 *
 * SAFETY: this client deliberately exposes ONLY the operations the project
 * is allowed to perform per the documented Jira write-safety constraints
 * (see PROGRESS_CLIRIM.md → Decisions, 2026-04-28). It does NOT expose:
 *   - DELETE /rest/api/3/issue/{key}
 *   - PUT /rest/api/3/issue/{key}      (edit fields)
 *   - POST /rest/api/3/issue/{key}/transitions
 *   - POST /rest/api/3/issue/{key}/comment (edit/create comments)
 *   - DELETE/PUT against any endpoint
 *
 * The only write operation is `createIssue`, and the controller layer
 * gates it behind an explicit two-step preview/confirm flow.
 */

const ATLASSIAN_API = '/rest/api/3';

export interface JiraIssueRaw {
  id: string;
  key: string;
  self: string;
  fields: {
    summary?: string;
    description?: unknown;
    issuetype?: { name?: string; id?: string };
    project?: { key?: string; name?: string };
    status?: { name?: string };
    priority?: { name?: string };
    labels?: string[];
    components?: Array<{ name?: string }>;
    assignee?: {
      emailAddress?: string;
      displayName?: string;
      accountId?: string;
    } | null;
    reporter?: { emailAddress?: string; displayName?: string } | null;
    created?: string;
    updated?: string;
    [k: string]: unknown;
  };
}

export interface JiraSearchResponse {
  issues: JiraIssueRaw[];
  total?: number;
  startAt?: number;
  maxResults?: number;
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraCreateIssueInput {
  projectKey: string;
  issueType: string;
  summary: string;
  /** Plain text — converted to ADF (Atlassian Document Format) at request time. */
  description?: string;
  labels?: string[];
  /** Jira priority name (e.g. "Highest", "High", "Medium", "Low"). */
  priority?: string;
  /**
   * Extra Jira fields (e.g. customfield_NNNNN) merged into `fields` verbatim.
   * Used for the LV project's required custom fields (Product, Sparte, Task area, etc).
   */
  customFields?: Record<string, unknown>;
}

@Injectable()
export class JiraClient implements OnModuleInit {
  private readonly logger = new Logger('JiraClient');
  private baseUrl: string | null = null;
  private authHeader: string | null = null;

  onModuleInit(): void {
    const baseUrl = process.env.JIRA_BASE_URL?.trim().replace(/\/+$/, '');
    const email = process.env.JIRA_USER_EMAIL?.trim();
    const token = process.env.JIRA_API_TOKEN?.trim();

    if (!baseUrl || !email || !token) {
      this.logger.warn(
        'Jira not configured (need JIRA_BASE_URL + JIRA_USER_EMAIL + JIRA_API_TOKEN) — Jira endpoints will return 503'
      );
      return;
    }
    this.baseUrl = baseUrl;
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.logger.log(`Jira client initialised (${baseUrl})`);
  }

  get isConfigured(): boolean {
    return this.baseUrl !== null && this.authHeader !== null;
  }

  /** GET /rest/api/3/myself — used to verify credentials on demand. */
  async whoami(): Promise<{ accountId: string; emailAddress?: string; displayName?: string }> {
    return this.get<{ accountId: string; emailAddress?: string; displayName?: string }>(
      '/myself'
    );
  }

  /**
   * GET /rest/api/3/search/jql with the new (post-2024) pagination model.
   * The caller must pre-validate the JQL via JqlBuilderService — this client
   * does NOT validate scope. nextPageToken is forwarded for paged sync.
   */
  async searchByJql(input: {
    jql: string;
    fields?: string[];
    maxResults?: number;
    nextPageToken?: string;
  }): Promise<JiraSearchResponse> {
    this.requireConfigured();
    const body: Record<string, unknown> = {
      jql: input.jql,
      fields: input.fields ?? [
        'summary',
        'description',
        'issuetype',
        'project',
        'status',
        'priority',
        'labels',
        'components',
        'fixVersions',
        'assignee',
        'reporter',
        'created',
        'updated',
      ],
      maxResults: Math.min(100, Math.max(1, input.maxResults ?? 50)),
    };
    if (input.nextPageToken) body['nextPageToken'] = input.nextPageToken;
    return this.post<JiraSearchResponse>('/search/jql', body);
  }

  async getIssue(key: string): Promise<JiraIssueRaw> {
    this.requireConfigured();
    return this.get<JiraIssueRaw>(`/issue/${encodeURIComponent(key)}`);
  }

  /**
   * POST /rest/api/3/issue — only allowed write. Caller MUST have already
   * obtained explicit user confirmation (handled in BugReportsController's
   * push-to-jira/confirm flow).
   */
  async createIssue(
    input: JiraCreateIssueInput
  ): Promise<{ id: string; key: string; self: string }> {
    this.requireConfigured();
    const adf = input.description
      ? this.textToAdf(input.description)
      : undefined;
    const body = {
      fields: {
        project: { key: input.projectKey },
        issuetype: { name: input.issueType },
        summary: input.summary,
        ...(adf ? { description: adf } : {}),
        ...(input.labels && input.labels.length > 0
          ? { labels: input.labels }
          : {}),
        ...(input.priority ? { priority: { name: input.priority } } : {}),
        ...(input.customFields ?? {}),
      },
    };
    return this.post<{ id: string; key: string; self: string }>('/issue', body);
  }

  /**
   * Upload one or more file attachments to an existing Jira issue.
   * Jira requires the `X-Atlassian-Token: no-check` header on this endpoint.
   * Returns the array of attachment metadata Jira sends back.
   */
  async addAttachments(
    issueKey: string,
    files: Array<{ filename: string; contentType: string; bytes: Buffer }>
  ): Promise<Array<{ id: string; filename: string }>> {
    this.requireConfigured();
    if (files.length === 0) return [];
    const form = new FormData();
    for (const f of files) {
      // Buffer → Uint8Array → Blob avoids a Node-vs-DOM Blob mismatch
      // and ensures the byte payload is sent verbatim.
      const blob = new Blob([new Uint8Array(f.bytes)], { type: f.contentType });
      form.append('file', blob, f.filename);
    }
    const url = `${this.baseUrl}${ATLASSIAN_API}/issue/${encodeURIComponent(
      issueKey
    )}/attachments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader!,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      throw new Error(
        `Jira POST /issue/${issueKey}/attachments failed: ${res.status} ${text.slice(
          0,
          500
        )}`
      );
    }
    return (await res.json()) as Array<{ id: string; filename: string }>;
  }

  // ---- internals --------------------------------------------------------

  private requireConfigured(): void {
    if (!this.isConfigured) {
      throw new Error(
        'Jira client is not configured (set JIRA_BASE_URL + JIRA_USER_EMAIL + JIRA_API_TOKEN)'
      );
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${ATLASSIAN_API}${path}`, {
      method: 'GET',
      headers: this.headers(),
    });
    return this.handleResponse<T>(res, `GET ${path}`);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${ATLASSIAN_API}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res, `POST ${path}`);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader!,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async handleResponse<T>(res: Response, ctx: string): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      throw new Error(
        `Jira ${ctx} failed: ${res.status} ${text.slice(0, 500)}`
      );
    }
    return (await res.json()) as T;
  }

  /**
   * Convert lightweight Markdown into Atlassian Document Format. Supports:
   * - "- " / "* " / "• " lines → bulletList items (consecutive lines grouped)
   * - "## " / "### " lines → heading levels 2 / 3
   * - "**bold**" inline runs → text with strong mark
   * - Empty lines → paragraph break
   * - Everything else → paragraph
   * Anything not recognised falls back to a literal paragraph so we never lose content.
   */
  private textToAdf(text: string): unknown {
    type AdfNode = Record<string, unknown>;
    const lines = text.split(/\r?\n/);
    const content: AdfNode[] = [];

    const inlineFromText = (s: string): AdfNode[] => {
      const parts: AdfNode[] = [];
      const re = /\*\*([^*]+)\*\*/g;
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        if (m.index > lastIdx) {
          parts.push({ type: 'text', text: s.slice(lastIdx, m.index) });
        }
        parts.push({
          type: 'text',
          text: m[1],
          marks: [{ type: 'strong' }],
        });
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < s.length) {
        parts.push({ type: 'text', text: s.slice(lastIdx) });
      }
      return parts.length === 0 ? [{ type: 'text', text: s }] : parts;
    };

    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trimEnd();

      if (line.trim().length === 0) {
        i++;
        continue;
      }

      // Headings
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        content.push({
          type: 'heading',
          attrs: { level: Math.min(3, h[1].length) },
          content: inlineFromText(h[2]),
        });
        i++;
        continue;
      }

      // Bullet group
      if (/^[\s]*[-*•]\s+/.test(line)) {
        const items: AdfNode[] = [];
        while (i < lines.length && /^[\s]*[-*•]\s+/.test(lines[i].trimEnd())) {
          const itemText = lines[i].trimEnd().replace(/^[\s]*[-*•]\s+/, '');
          items.push({
            type: 'listItem',
            content: [
              { type: 'paragraph', content: inlineFromText(itemText) },
            ],
          });
          i++;
        }
        content.push({ type: 'bulletList', content: items });
        continue;
      }

      // Numbered group
      if (/^[\s]*\d+\.\s+/.test(line)) {
        const items: AdfNode[] = [];
        while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i].trimEnd())) {
          const itemText = lines[i].trimEnd().replace(/^[\s]*\d+\.\s+/, '');
          items.push({
            type: 'listItem',
            content: [
              { type: 'paragraph', content: inlineFromText(itemText) },
            ],
          });
          i++;
        }
        content.push({ type: 'orderedList', content: items });
        continue;
      }

      // Plain paragraph
      content.push({ type: 'paragraph', content: inlineFromText(line) });
      i++;
    }

    if (content.length === 0) {
      content.push({ type: 'paragraph', content: [] });
    }

    return { type: 'doc', version: 1, content };
  }
}
