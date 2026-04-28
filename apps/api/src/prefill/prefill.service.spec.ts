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
