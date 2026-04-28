import { BadRequestException, Injectable } from '@nestjs/common';

export interface BuildJqlInput {
  /** Free-form additional clause from the agent / user (optional). */
  rawJql?: string;
  /** Convenience filters that the server composes into JQL safely. */
  status?: string;
  assigneeEmail?: string;
  textContains?: string;
  /** Optional explicit project key restrict — must be in allowlist. */
  project?: string;
  orderBy?: 'created' | 'updated';
}

@Injectable()
export class JqlBuilderService {
  /**
   * Compose and validate a JQL string. The result is GUARANTEED to be
   * scoped to one or more projects in the allowlist.
   *
   * Forbidden constructs:
   *  - Unbounded queries with no project filter
   *  - Reordering, mutating, or transitioning operators (sub-clauses with
   *    `delete`, `editBy`, `transitionedBy` etc. are not part of JQL anyway,
   *    but we explicitly reject any leading `;` to discourage injection
   *    attempts)
   *  - References to projects outside the allowlist
   */
  build(input: BuildJqlInput): string {
    const allowlist = this.allowedProjects();
    if (allowlist.length === 0) {
      throw new BadRequestException(
        'JIRA_ALLOWED_PROJECTS is not set — refusing to build any JQL until configured'
      );
    }

    const targetProjects = input.project
      ? this.resolveProject(input.project, allowlist)
      : allowlist;

    const clauses: string[] = [
      `project IN (${targetProjects.map((p) => `"${p}"`).join(',')})`,
    ];

    if (input.status) {
      const safeStatus = this.escapeQuoted(input.status);
      clauses.push(`status = "${safeStatus}"`);
    }

    if (input.assigneeEmail) {
      const safeEmail = this.escapeQuoted(input.assigneeEmail);
      clauses.push(`assignee = "${safeEmail}"`);
    }

    if (input.textContains) {
      const safeText = this.escapeQuoted(input.textContains);
      clauses.push(`(summary ~ "${safeText}" OR description ~ "${safeText}")`);
    }

    if (input.rawJql && input.rawJql.trim().length > 0) {
      const cleaned = this.sanitizeRaw(input.rawJql);
      this.assertRawIsReadOnly(cleaned);
      this.assertRawTouchesAllowedProjectsOnly(cleaned, allowlist);
      clauses.push(`(${cleaned})`);
    }

    let jql = clauses.join(' AND ');
    if (input.orderBy) {
      jql += ` ORDER BY ${input.orderBy === 'updated' ? 'updated' : 'created'} DESC`;
    }
    return jql;
  }

  /** Validate and return the project key as the agent supplied it. */
  resolveProject(key: string, allowlist?: string[]): string[] {
    const list = allowlist ?? this.allowedProjects();
    const upper = key.trim().toUpperCase();
    if (!list.includes(upper)) {
      throw new BadRequestException(
        `Project '${key}' is not in JIRA_ALLOWED_PROJECTS (allowed: ${list.join(', ')})`
      );
    }
    return [upper];
  }

  allowedProjects(): string[] {
    const raw = process.env.JIRA_ALLOWED_PROJECTS?.trim() ?? '';
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  // ---- internals --------------------------------------------------------

  private escapeQuoted(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private sanitizeRaw(jql: string): string {
    const trimmed = jql.trim();
    // Strip trailing semicolons; explicit injection-shaped tails.
    return trimmed.replace(/;+\s*$/g, '');
  }

  private assertRawIsReadOnly(jql: string): void {
    // JQL has no native mutation operators, but we still defensively reject
    // anything that looks like SQL injection (e.g. attempts to chain
    // statements via `;`, or to use Jira REST URI paths inside JQL).
    if (/[;]/.test(jql)) {
      throw new BadRequestException(
        'JQL must not contain semicolons (rejected as a precaution)'
      );
    }
    if (/\b(delete|drop|update|insert)\b/i.test(jql)) {
      throw new BadRequestException(
        'JQL contains a forbidden keyword (delete/drop/update/insert)'
      );
    }
  }

  private assertRawTouchesAllowedProjectsOnly(
    jql: string,
    allowlist: string[]
  ): void {
    const projectMatches = jql.matchAll(
      /\bproject\s*(?:=|in)\s*\(?\s*"?([A-Z][A-Z0-9_]*)"?/gi
    );
    for (const match of projectMatches) {
      const ref = match[1].toUpperCase();
      if (!allowlist.includes(ref)) {
        throw new BadRequestException(
          `Raw JQL references project '${ref}' which is not in JIRA_ALLOWED_PROJECTS`
        );
      }
    }
  }
}
