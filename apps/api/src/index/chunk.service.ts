import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_INCLUDE = [
  '.ts',
  '.tsx',
  '.js',
  '.html',
  '.scss',
  '.css',
  '.json',
  '.md',
  '.sql',
];

const DEFAULT_EXCLUDE = [
  'node_modules',
  '.git',
  '.nx',
  'dist',
  'tmp',
  'coverage',
  '.next',
  '.angular',
];

const WINDOW_LINES = 120;
const WINDOW_OVERLAP = 20;
const MIN_CHARS = 30;
const MAX_CHARS = 16_000;

export interface RawChunk {
  path: string; // relative to root
  symbol: string | null;
  kind: 'window' | 'file';
  startLine: number;
  endLine: number;
  content: string;
}

export interface ChunkOptions {
  include?: string[];
  exclude?: string[];
}

@Injectable()
export class ChunkService {
  private readonly logger = new Logger('ChunkService');

  async chunkRepo(root: string, opts: ChunkOptions = {}): Promise<RawChunk[]> {
    const include = opts.include ?? DEFAULT_INCLUDE;
    const exclude = opts.exclude ?? DEFAULT_EXCLUDE;
    const allFiles = await collectFiles(root, root, include, exclude);
    this.logger.log(`Walking ${allFiles.length} candidate files`);

    const chunks: RawChunk[] = [];
    for (const abs of allFiles) {
      const rel = relative(root, abs);
      try {
        const text = await fs.readFile(abs, 'utf8');
        const trimmed = text.trim();
        if (trimmed.length < MIN_CHARS) continue;
        const lines = text.split(/\r?\n/);
        if (lines.length <= WINDOW_LINES) {
          chunks.push({
            path: rel,
            symbol: null,
            kind: 'file',
            startLine: 1,
            endLine: lines.length,
            content: capContent(text),
          });
          continue;
        }
        let start = 0;
        while (start < lines.length) {
          const end = Math.min(lines.length, start + WINDOW_LINES);
          const slice = lines.slice(start, end).join('\n');
          if (slice.trim().length >= MIN_CHARS) {
            chunks.push({
              path: rel,
              symbol: null,
              kind: 'window',
              startLine: start + 1,
              endLine: end,
              content: capContent(slice),
            });
          }
          if (end >= lines.length) break;
          start = end - WINDOW_OVERLAP;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to read ${rel}: ${(err as Error).message}`
        );
      }
    }

    this.logger.log(`Produced ${chunks.length} chunks`);
    return chunks;
  }
}

async function collectFiles(
  root: string,
  current: string,
  include: string[],
  exclude: string[]
): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(root, full, include, exclude);
      out.push(...nested);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (include.some((ext) => lower.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

function capContent(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS) + '\n// ...truncated';
}
