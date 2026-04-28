import { ValidationRulesSeeder } from './seeder';
import type { ValidationRulesService } from './validation-rules.service';

describe('ValidationRulesSeeder', () => {
  const fakeService = {
    upsert: jest.fn().mockResolvedValue({}),
  } as unknown as ValidationRulesService & { upsert: jest.Mock };

  beforeEach(() => jest.clearAllMocks());

  it('upserts every entry from each Sparte file with source="seed"', async () => {
    const seedFiles = {
      'Kfz.json': [
        {
          fieldPath: 'einstieg.tarif',
          label: 'Tarif',
          type: 'enum',
          validators: [{ kind: 'required' as const }],
          enumValues: ['A', 'B'],
          humanRule: 'Tarif key.',
          synonyms: ['tarifart'],
        },
      ],
      'Bu.json': [
        {
          fieldPath: 'beruf',
          label: 'Beruf',
          type: 'string',
          validators: [{ kind: 'required' as const }],
          humanRule: 'Beruf des VN.',
          synonyms: ['profession', 'job'],
        },
      ],
    };
    const seeder = new ValidationRulesSeeder(fakeService);
    await seeder.runWithFiles(seedFiles);
    expect(fakeService.upsert).toHaveBeenCalledTimes(2);
    expect(
      (fakeService.upsert as jest.Mock).mock.calls[0],
    ).toEqual([
      expect.objectContaining({
        sparte: 'Kfz',
        fieldPath: 'einstieg.tarif',
      }),
      'seed',
    ]);
    expect(
      (fakeService.upsert as jest.Mock).mock.calls[1],
    ).toEqual([
      expect.objectContaining({
        sparte: 'Bu',
        fieldPath: 'beruf',
      }),
      'seed',
    ]);
  });

  it('does nothing when seedFiles is empty', async () => {
    const seeder = new ValidationRulesSeeder(fakeService);
    await seeder.runWithFiles({});
    expect(fakeService.upsert).not.toHaveBeenCalled();
  });
});
