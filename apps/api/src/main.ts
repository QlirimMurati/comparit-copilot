import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { bootstrapAdmin } from './db/bootstrap-admin';
import { runMigrations } from './db/run-migrations';

async function bootstrap() {
  await runMigrations();
  await bootstrapAdmin();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    credentials: true,
  });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  Logger.log(`comparit-copilot-api listening on http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  Logger.error(
    `Failed to start API: ${(err as Error).message}`,
    (err as Error).stack,
  );
  process.exit(1);
});
