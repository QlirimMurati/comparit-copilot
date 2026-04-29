import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { bootstrapAdmin } from './db/bootstrap-admin';
import { runMigrations } from './db/run-migrations';

async function bootstrap() {
  await runMigrations();
  await bootstrapAdmin();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Attachment uploads use base64 in JSON; 5MB binary ≈ ~6.7MB encoded.
  // Bump the default body limit so the upload endpoint isn't rejected.
  app.useBodyParser('json', { limit: '8mb' });
  app.useBodyParser('urlencoded', { limit: '8mb', extended: true });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('comparit-copilot API')
    .setDescription(
      'Internal automation/copilot platform for the Comparit team. ' +
        'Admin endpoints use JWT (`Authorization: Bearer <token>`); ' +
        'widget endpoints use HTTP Basic Auth (`widget:local` from `.env`).'
    )
    .setVersion(process.env.APP_VERSION || '0.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt'
    )
    .addBasicAuth({ type: 'http', scheme: 'basic' }, 'widget-basic')
    .addTag('health', 'Liveness + database checks')
    .addTag('auth', 'Login + current-user (JWT)')
    .addTag('reports', 'Bug-report CRUD (JWT)')
    .addTag('widget', 'Public widget submission (Basic Auth)')
    .addTag('widget-chat', 'AI bug-intake chat (Basic Auth)')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  Logger.log(`comparit-copilot-api listening on http://localhost:${port}/api`);
  Logger.log(`Swagger UI:  http://localhost:${port}/api/docs`);
  Logger.log(`OpenAPI JSON: http://localhost:${port}/api/docs-json`);
}

bootstrap().catch((err) => {
  Logger.error(`Failed to start API: ${(err as Error).message}`, (err as Error).stack);
  process.exit(1);
});
