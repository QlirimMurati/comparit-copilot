import { VoyageService } from './voyage.service';

describe('VoyageService', () => {
  const originalFetch = global.fetch;
  let svc: VoyageService;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = 'test-key';
    svc = new VoyageService();
    svc.onModuleInit();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.VOYAGE_API_KEY;
  });

  it('isConfigured is true when VOYAGE_API_KEY is set', () => {
    expect(svc.isConfigured).toBe(true);
  });

  it('embedText posts to Voyage and returns the vector', async () => {
    const vec = Array.from({ length: 1024 }, (_, i) => i / 1024);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: vec, index: 0 }], model: 'voyage-3', usage: { total_tokens: 5 } }),
    }) as unknown as typeof fetch;

    const out = await svc.embedText('hello world', 'document');
    expect(out).toEqual(vec);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    );
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body
    );
    expect(body).toEqual({
      input: ['hello world'],
      model: 'voyage-3',
      input_type: 'document',
      output_dimension: 1024,
    });
  });

  it('throws on non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    }) as unknown as typeof fetch;

    await expect(svc.embedText('hi')).rejects.toThrow(/401/);
  });

  it('throws when API returns wrong-dimension vector', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0, 1, 2], index: 0 }] }),
    }) as unknown as typeof fetch;

    await expect(svc.embedText('hi')).rejects.toThrow(/unexpected embedding shape/);
  });

  it('throws when not configured', async () => {
    delete process.env.VOYAGE_API_KEY;
    const unsvc = new VoyageService();
    unsvc.onModuleInit();
    expect(unsvc.isConfigured).toBe(false);
    await expect(unsvc.embedText('hi')).rejects.toThrow(/not configured/);
  });

  it('rejects empty input', async () => {
    await expect(svc.embedText('   ')).rejects.toThrow(/empty/);
  });
});
