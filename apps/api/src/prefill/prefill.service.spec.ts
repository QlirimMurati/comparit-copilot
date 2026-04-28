import { Test } from '@nestjs/testing';
import * as swaggerLoader from './lib/swagger-loader';
import { PrefillService } from './prefill.service';

describe('PrefillService.validate', () => {
  beforeEach(() => {
    jest.spyOn(swaggerLoader, 'loadSchema').mockResolvedValue({
      stage: 'live',
      loadedAt: Date.now(),
      enums: { KfzNutzungstypEnum: ['Privat', 'Gewerblich'] },
      prefillSchemas: {
        Kfz: {
          fields: {
            sparte: { type: 'string', nullable: false },
            nutzung: {
              type: 'enum',
              enumName: 'KfzNutzungstypEnum',
              nullable: false,
            },
          },
          required: [],
          requiredByPath: {},
        },
      },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  async function build(): Promise<PrefillService> {
    const moduleRef = await Test.createTestingModule({
      providers: [PrefillService],
    }).compile();
    return moduleRef.get(PrefillService);
  }

  it('returns valid: true for a known-good Kfz payload', async () => {
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Kfz', nutzung: 'Privat' });
    const result = await svc.validate({ sparte: 'Kfz', json, stage: 'live' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.schemaSource).toBe('live');
    expect(result.stage).toBe('live');
    expect(result.cleanJson).toBeDefined();
  });

  it('falls back to the static schema when loadSchema rejects', async () => {
    jest
      .spyOn(swaggerLoader, 'loadSchema')
      .mockRejectedValue(new Error('network down'));
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Kfz' });
    const result = await svc.validate({ sparte: 'Kfz', json, stage: 'qa' });
    expect(result.schemaSource).toBe('static');
    expect(result.stage).toBe('qa');
    expect(result.errors).toEqual(expect.any(Array));
  });

  it('throws BadRequestException for invalid JSON', async () => {
    const svc = await build();
    await expect(
      svc.validate({ sparte: 'Kfz', json: 'not json at all', stage: 'live' }),
    ).rejects.toThrow(/Invalid JSON/);
  });

  it('throws BadRequestException for unknown sparte', async () => {
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Xyz' });
    await expect(
      svc.validate({ sparte: 'Xyz', json, stage: 'live' }),
    ).rejects.toThrow(/Unknown sparte/);
  });

  it('reports validation errors for a bad enum value', async () => {
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Kfz', nutzung: 'Bogus' });
    const result = await svc.validate({ sparte: 'Kfz', json, stage: 'live' });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('nutzung');
  });
});

describe('PrefillService.listSparten', () => {
  it('returns all 11 sparten with German labels', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrefillService],
    }).compile();
    const svc = moduleRef.get(PrefillService);
    const result = svc.listSparten();
    expect(result).toEqual(
      expect.arrayContaining([
        { key: 'Kfz', label: 'KFZ-Versicherung' },
        { key: 'Phv', label: 'Privathaftpflichtversicherung' },
      ]),
    );
    expect(result).toHaveLength(11);
  });
});

describe('PrefillService.validateForChat', () => {
  function liveSchemaMock() {
    return {
      stage: 'live' as const,
      loadedAt: Date.now(),
      enums: { KfzNutzungstypEnum: ['Privat', 'Gewerblich'] },
      prefillSchemas: {
        Kfz: {
          fields: {
            sparte: { type: 'string' as const, nullable: false },
            einstieg: {
              type: 'object' as const,
              nullable: false,
              objectSchema: {
                typ: { type: 'string' as const, nullable: false },
                tarif: { type: 'string' as const, nullable: false },
              },
            },
            fahrzeug: { type: 'object' as const, nullable: false },
          },
          required: ['einstieg', 'fahrzeug'],
          requiredByPath: { einstieg: ['typ', 'tarif'] },
        },
      },
    };
  }

  async function build(): Promise<PrefillService> {
    const moduleRef = await Test.createTestingModule({
      providers: [PrefillService],
    }).compile();
    return moduleRef.get(PrefillService);
  }

  beforeEach(() => {
    jest.spyOn(swaggerLoader, 'loadSchema').mockResolvedValue(liveSchemaMock());
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns valid: true when nothing is missing and types match', async () => {
    const svc = await build();
    const json = JSON.stringify({
      sparte: 'Kfz',
      einstieg: { typ: 'A', tarif: 'B' },
      fahrzeug: {},
    });
    const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
    expect(result.valid).toBe(true);
    expect(result.typeErrors).toEqual([]);
    expect(result.missingRequired).toEqual([]);
    expect(result.sparte).toBe('Kfz');
    expect(result.stage).toBe('live');
    expect(result.schemaSource).toBe('live');
  });

  it('reports a missing top-level required field', async () => {
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Kfz', fahrzeug: {} });
    const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toEqual([{ path: 'einstieg' }]);
  });

  it('reports nested missing required fields when parent is present', async () => {
    const svc = await build();
    const json = JSON.stringify({
      sparte: 'Kfz',
      einstieg: { typ: 'A' },
      fahrzeug: {},
    });
    const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toEqual([{ path: 'einstieg.tarif' }]);
  });

  it('does not double-report nested when parent itself is missing', async () => {
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Kfz', fahrzeug: {} });
    const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
    const paths = result.missingRequired.map((m) => m.path);
    expect(paths).toContain('einstieg');
    expect(paths).not.toContain('einstieg.typ');
    expect(paths).not.toContain('einstieg.tarif');
  });

  it('auto-detects sparte from data.sparte when not passed', async () => {
    const svc = await build();
    const json = JSON.stringify({
      sparte: 'Kfz',
      einstieg: { typ: 'A', tarif: 'B' },
      fahrzeug: {},
    });
    const result = await svc.validateForChat({ json, stage: 'live' });
    expect(result.sparte).toBe('Kfz');
  });

  it('auto-detects sparte from data.prefillData.sparte', async () => {
    const svc = await build();
    const json = JSON.stringify({
      prefillData: {
        sparte: 'Kfz',
        einstieg: { typ: 'A', tarif: 'B' },
        fahrzeug: {},
      },
    });
    const result = await svc.validateForChat({ json, stage: 'live' });
    expect(result.sparte).toBe('Kfz');
  });

  it('throws BadRequestException when sparte cannot be resolved', async () => {
    const svc = await build();
    const json = JSON.stringify({ einstieg: {} });
    await expect(svc.validateForChat({ json, stage: 'live' })).rejects.toThrow(
      /Could not detect sparte/,
    );
  });

  it('returns empty missingRequired when falling back to static schema', async () => {
    jest
      .spyOn(swaggerLoader, 'loadSchema')
      .mockRejectedValue(new Error('network down'));
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Kfz' });
    const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'qa' });
    expect(result.schemaSource).toBe('static');
    expect(result.missingRequired).toEqual([]);
    expect(result.stage).toBe('qa');
  });

  it('combines type errors and missing required (valid is false)', async () => {
    const svc = await build();
    const json = JSON.stringify({
      sparte: 'Kfz',
      einstieg: 'not-an-object',
    });
    const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
    expect(result.valid).toBe(false);
    expect(result.typeErrors.length).toBeGreaterThan(0);
    expect(result.missingRequired.map((m) => m.path)).toContain('fahrzeug');
  });
});
