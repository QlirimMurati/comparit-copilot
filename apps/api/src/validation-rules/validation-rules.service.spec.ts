import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../db/db.module';
import { ValidationRulesService } from './validation-rules.service';

interface FakeRow {
  id: string;
  sparte: string;
  fieldPath: string;
  label: string;
  type: string;
  validators: unknown[];
  enumValues: string[] | null;
  humanRule: string;
  synonyms: string[];
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const SAMPLE: FakeRow = {
  id: '11111111-1111-1111-1111-111111111111',
  sparte: 'Kfz',
  fieldPath: 'versicherungsnehmer.geburtsdatum',
  label: 'Geburtsdatum',
  type: 'date',
  validators: [{ kind: 'required' }],
  enumValues: null,
  humanRule: 'Date of birth. Required.',
  synonyms: ['DOB', 'Geburtstag'],
  source: 'seed',
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function build(db: unknown): Promise<ValidationRulesService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ValidationRulesService,
      { provide: DRIZZLE, useValue: db },
    ],
  }).compile();
  return moduleRef.get(ValidationRulesService);
}

describe('ValidationRulesService.lookup', () => {
  it('matches case-insensitively by label, fieldPath, or synonym', async () => {
    const db = { execute: jest.fn().mockResolvedValue([SAMPLE]) };
    const svc = await build(db);
    const result = await svc.lookup('GEBURTSDATUM');
    expect(result).toHaveLength(1);
    expect(result[0].sparte).toBe('Kfz');
    expect(result[0].synonyms).toContain('DOB');
  });

  it('forwards the sparte filter to the query', async () => {
    const db = { execute: jest.fn().mockResolvedValue([]) };
    const svc = await build(db);
    await svc.lookup('geburtsdatum', 'Kfz');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe('ValidationRulesService.upsert', () => {
  it('inserts via ON CONFLICT DO UPDATE and returns the row', async () => {
    const inserted = { ...SAMPLE };
    const db = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([inserted]),
          }),
        }),
      }),
    };
    const svc = await build(db);
    const result = await svc.upsert(
      {
        sparte: 'Kfz',
        fieldPath: 'versicherungsnehmer.geburtsdatum',
        label: 'Geburtsdatum',
        type: 'date',
        validators: [{ kind: 'required' }],
        humanRule: 'Date of birth.',
        synonyms: ['DOB'],
      },
      'seed',
    );
    expect(result.sparte).toBe('Kfz');
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('ValidationRulesService.addSynonym', () => {
  function buildDbForUpdate(
    selectRow: FakeRow | undefined,
    updatedRow: FakeRow,
  ) {
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(selectRow ? [selectRow] : []),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedRow]),
          }),
        }),
      }),
    };
  }

  it('appends a new synonym, dedups, and flips source to manual', async () => {
    const updated = {
      ...SAMPLE,
      synonyms: ['DOB', 'Geburtstag', 'birthdate'],
      source: 'manual',
    };
    const db = buildDbForUpdate(SAMPLE, updated);
    const svc = await build(db);
    const result = await svc.addSynonym(SAMPLE.id, 'birthdate');
    expect(result.synonyms).toContain('birthdate');
    expect(result.source).toBe('manual');
    expect(db.update).toHaveBeenCalled();
  });

  it('does not duplicate an existing synonym (case-insensitive)', async () => {
    const updated = { ...SAMPLE, source: 'manual' };
    const db = buildDbForUpdate(SAMPLE, updated);
    const svc = await build(db);
    await svc.addSynonym(SAMPLE.id, 'dob');
    const setCall = (
      db.update.mock.results[0].value.set as jest.Mock
    ).mock.calls[0][0] as { synonyms: string[] };
    expect(setCall.synonyms).toEqual(['DOB', 'Geburtstag']);
  });

  it('throws NotFoundException when the rule does not exist', async () => {
    const db = buildDbForUpdate(undefined, SAMPLE);
    const svc = await build(db);
    await expect(
      svc.addSynonym('00000000-0000-0000-0000-000000000000', 'X'),
    ).rejects.toThrow(/not found/i);
  });
});
