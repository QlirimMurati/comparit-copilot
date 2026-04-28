import type { Database } from '../db/db.module';
import { PromptRegistryService } from './prompt-registry.service';

function makeMockDb(opts: {
  selectRows: unknown[];
  updateMock?: jest.Mock;
  insertMock?: jest.Mock;
}) {
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(opts.selectRows)),
        })),
      })),
    })),
  }));
  const update = jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([])),
      })),
    })),
  }));
  const insert = jest.fn(() => ({
    values: jest.fn(() => ({
      returning: jest.fn(() =>
        Promise.resolve(opts.insertMock ? [opts.insertMock()] : [])
      ),
    })),
  }));
  return { select, update, insert } as unknown as Database;
}

describe('PromptRegistryService.getActiveContent', () => {
  it('returns DB override when one is active', async () => {
    const db = makeMockDb({ selectRows: [{ content: 'OVERRIDE TEXT' }] });
    const svc = new PromptRegistryService(db);
    const out = await svc.getActiveContent('intake');
    expect(out).toBe('OVERRIDE TEXT');
  });

  it('falls back to baked default when no override is active', async () => {
    const db = makeMockDb({ selectRows: [] });
    const svc = new PromptRegistryService(db);
    const out = await svc.getActiveContent('intake');
    expect(out).toMatch(/comparer-ui/i); // INTAKE_SYSTEM_INSTRUCTIONS mentions comparer-ui
  });
});
