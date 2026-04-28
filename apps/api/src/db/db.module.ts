import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DRIZZLE = 'DRIZZLE_DB';
export type Database = ReturnType<typeof drizzle<typeof schema>>;

const drizzleProvider = {
  provide: DRIZZLE,
  useFactory: () => {
    const url =
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/copilot';
    const client = postgres(url, { max: 10 });
    Logger.log(`Connected to database at ${url.replace(/:[^@]*@/, ':***@')}`, 'DbModule');
    return drizzle(client, { schema });
  },
};

@Global()
@Module({
  providers: [drizzleProvider],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  async onModuleDestroy() {
    // postgres-js connections are managed by the provider's pool;
    // process exit will clean them up. Hook left for future explicit teardown.
  }
}
