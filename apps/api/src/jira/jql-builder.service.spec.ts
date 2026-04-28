import { BadRequestException } from '@nestjs/common';
import { JqlBuilderService } from './jql-builder.service';

describe('JqlBuilderService', () => {
  let svc: JqlBuilderService;
  const originalAllowed = process.env.JIRA_ALLOWED_PROJECTS;

  beforeEach(() => {
    process.env.JIRA_ALLOWED_PROJECTS = 'LV,KFZ';
    svc = new JqlBuilderService();
  });

  afterEach(() => {
    if (originalAllowed === undefined) delete process.env.JIRA_ALLOWED_PROJECTS;
    else process.env.JIRA_ALLOWED_PROJECTS = originalAllowed;
  });

  it('refuses to build any JQL when the allowlist is empty', () => {
    delete process.env.JIRA_ALLOWED_PROJECTS;
    expect(() => svc.build({})).toThrow(BadRequestException);
  });

  it('always scopes to the allowlist when no project is supplied', () => {
    const jql = svc.build({});
    expect(jql).toMatch(/project IN \("LV","KFZ"\)/);
  });

  it('accepts an explicit allowed project', () => {
    const jql = svc.build({ project: 'lv', status: 'Open' });
    expect(jql).toMatch(/project IN \("LV"\)/);
    expect(jql).toMatch(/status = "Open"/);
  });

  it('rejects projects outside the allowlist', () => {
    expect(() => svc.build({ project: 'COMP' })).toThrow(BadRequestException);
  });

  it('rejects raw JQL referencing non-allowed projects', () => {
    expect(() =>
      svc.build({ rawJql: 'project = COMP AND status = Open' })
    ).toThrow(BadRequestException);
  });

  it('rejects raw JQL containing forbidden keywords', () => {
    expect(() =>
      svc.build({ rawJql: 'summary ~ "drop tables"' })
    ).toThrow(BadRequestException);
    expect(() =>
      svc.build({ rawJql: 'delete FROM issues' })
    ).toThrow(BadRequestException);
  });

  it('rejects raw JQL containing semicolons', () => {
    expect(() =>
      svc.build({ rawJql: 'status = Open; status = Closed' })
    ).toThrow(BadRequestException);
  });

  it('escapes embedded quotes in textContains', () => {
    const jql = svc.build({ textContains: 'login "broken"' });
    expect(jql).toContain('summary ~ "login \\"broken\\""');
  });

  it('appends ORDER BY when requested', () => {
    const jql = svc.build({ orderBy: 'updated' });
    expect(jql).toMatch(/ORDER BY updated DESC$/);
  });

  it('combines a sanitized raw clause via AND', () => {
    const jql = svc.build({
      project: 'LV',
      rawJql: 'priority = High AND project = LV',
      orderBy: 'created',
    });
    expect(jql).toMatch(/project IN \("LV"\)/);
    expect(jql).toContain('(priority = High AND project = LV)');
    expect(jql).toMatch(/ORDER BY created DESC$/);
  });

  it('uppercases project keys when comparing to the allowlist', () => {
    const out = svc.resolveProject('lv');
    expect(out).toEqual(['LV']);
  });
});
