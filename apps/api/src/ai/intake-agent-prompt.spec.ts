import { buildActiveCalcBlock } from './intake-agent.service';

describe('buildActiveCalcBlock', () => {
  it('renders sparte, values, and errors', () => {
    const text = buildActiveCalcBlock({
      sparte: 'bu',
      values: { geburtsdatum: '1990-05-12' },
      errors: [{ controlPath: 'beruf', errors: { required: true } }],
      capturedAt: '2026-04-29T00:00:00.000Z',
    });
    expect(text).toContain('## ACTIVE-CALCULATION CONTEXT');
    expect(text).toContain('AUTHORITATIVE');
    expect(text).toContain('Do NOT say "ich habe darauf keinen Zugriff"');
    expect(text).toContain('Sparte: bu');
    expect(text).toContain('"geburtsdatum": "1990-05-12"');
    expect(text).toContain('- beruf: required');
  });

  it('shows "(none)" when no errors are present', () => {
    const text = buildActiveCalcBlock({
      sparte: 'bu',
      values: {},
      errors: [],
      capturedAt: '2026-04-29T00:00:00.000Z',
    });
    expect(text).toContain('Validation errors visible to the user:\n  (none)');
  });
});
