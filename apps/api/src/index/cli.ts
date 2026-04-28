import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app/app.module';
import { SPARTEN, type Sparte } from '../db/schema';
import { CodeIndexService } from './code-index.service';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.path) {
    Logger.error(
      'Usage: pnpm tsx apps/api/src/index/cli.ts --path <repo> [--sparte <name>]'
    );
    process.exit(2);
  }
  if (args.sparte && !SPARTEN.includes(args.sparte as Sparte)) {
    Logger.error(`Invalid sparte '${args.sparte}'`);
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const indexer = app.get(CodeIndexService);
    const result = await indexer.indexRepo({
      path: args.path,
      sparte: (args.sparte as Sparte | undefined) ?? null,
    });
    Logger.log(`Indexed ${result.chunks} chunks`);
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): { path?: string; sparte?: string } {
  const out: { path?: string; sparte?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--path') out.path = argv[++i];
    else if (v === '--sparte') out.sparte = argv[++i];
  }
  return out;
}

main().catch((err) => {
  Logger.error(`index:repo failed: ${(err as Error).message}`);
  process.exit(1);
});
