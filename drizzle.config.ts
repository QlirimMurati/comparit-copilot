import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './apps/api/src/db/schema/index.ts',
  out: './apps/api/src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/copilot',
  },
  strict: true,
  verbose: true,
});
