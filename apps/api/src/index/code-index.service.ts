import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { cosineDistance, eq, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { codeChunks, type Sparte } from '../db/schema';
import { VoyageService } from '../ai/voyage.service';
import { ChunkService } from './chunk.service';

const DEFAULT_LIMIT = 10;
const DEFAULT_DISTANCE_CEILING = 0.5;

export interface IndexRepoOptions {
  /** Absolute path to repo root. */
  path: string;
  sparte?: Sparte | null;
}

export interface CodeSearchInput {
  query: string;
  sparte?: Sparte | null;
  limit?: number;
  maxDistance?: number;
}

export interface CodeSearchHit {
  id: string;
  path: string;
  sparte: Sparte | null;
  symbol: string | null;
  kind: string;
  startLine: number;
  endLine: number;
  content: string;
  distance: number;
}

@Injectable()
export class CodeIndexService {
  private readonly logger = new Logger('CodeIndexService');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly chunker: ChunkService,
    private readonly voyage: VoyageService
  ) {}

  async indexRepo(opts: IndexRepoOptions): Promise<{ chunks: number }> {
    if (!this.voyage.isConfigured) {
      throw new ServiceUnavailableException(
        'Voyage embeddings are not configured (set VOYAGE_API_KEY)'
      );
    }
    const chunks = await this.chunker.chunkRepo(opts.path);
    if (chunks.length === 0) return { chunks: 0 };

    // Wipe previous chunks for this sparte to keep things idempotent.
    if (opts.sparte) {
      await this.db
        .delete(codeChunks)
        .where(eq(codeChunks.sparte, opts.sparte));
    }

    const BATCH_SIZE = 64;
    let inserted = 0;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const slice = chunks.slice(i, i + BATCH_SIZE);
      try {
        const embeddings = await this.voyage.embedCodeBatch(
          slice.map(buildEmbeddingText),
          'document'
        );
        await this.db.insert(codeChunks).values(
          slice.map((chunk, idx) => ({
            path: chunk.path,
            sparte: opts.sparte ?? null,
            symbol: chunk.symbol,
            kind: chunk.kind,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content,
            embedding: embeddings[idx],
          }))
        );
        inserted += slice.length;
        this.logger.log(
          `Indexed ${inserted}/${chunks.length} chunks (batch +${slice.length})`
        );
      } catch (err) {
        this.logger.warn(
          `Failed batch ${i}-${i + slice.length}: ${(err as Error).message}`
        );
      }
    }
    this.logger.log(`Indexed ${inserted}/${chunks.length} chunks`);
    return { chunks: inserted };
  }

  async search(input: CodeSearchInput): Promise<CodeSearchHit[]> {
    if (!this.voyage.isConfigured) {
      throw new ServiceUnavailableException(
        'Voyage embeddings are not configured (set VOYAGE_API_KEY)'
      );
    }
    const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, 50);
    const ceiling = clampNum(
      input.maxDistance ?? DEFAULT_DISTANCE_CEILING,
      0,
      2
    );

    const queryVec = await this.voyage.embedCode(input.query, 'query');
    const distance = cosineDistance(codeChunks.embedding, queryVec);

    const baseWhere = isNotNull(codeChunks.embedding);
    // When a sparte filter is provided, also include null-sparte chunks
    // (shared infra/components) — those frequently contain the affected code.
    const where = input.sparte
      ? sql`${baseWhere} AND (${codeChunks.sparte} = ${input.sparte} OR ${codeChunks.sparte} IS NULL)`
      : baseWhere;

    const rows = await this.db
      .select({
        id: codeChunks.id,
        path: codeChunks.path,
        sparte: codeChunks.sparte,
        symbol: codeChunks.symbol,
        kind: codeChunks.kind,
        startLine: codeChunks.startLine,
        endLine: codeChunks.endLine,
        content: codeChunks.content,
        distance: sql<number>`${distance}`.as('distance'),
      })
      .from(codeChunks)
      .where(where)
      .orderBy(distance)
      .limit(limit);

    return rows
      .filter((r) => r.distance <= ceiling)
      .map((r) => ({
        id: r.id,
        path: r.path,
        sparte: (r.sparte ?? null) as Sparte | null,
        symbol: r.symbol ?? null,
        kind: r.kind,
        startLine: r.startLine,
        endLine: r.endLine,
        content: r.content,
        distance: Number(r.distance),
      }));
  }
}

function buildEmbeddingText(chunk: {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
}): string {
  const head = `// File: ${chunk.path}${
    chunk.symbol ? ` · ${chunk.symbol}` : ''
  } (lines ${chunk.startLine}-${chunk.endLine})`;
  return `${head}\n${chunk.content}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
