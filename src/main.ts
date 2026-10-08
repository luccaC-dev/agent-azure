import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { buildContext } from './app-context';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const ctx = buildContext(config);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forContext(ctx), { logger: ['error', 'warn'] });
  // Container Apps terminates TLS at its ingress; trust it so req.protocol is the public scheme.
  app.set('trust proxy', true);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  console.log(JSON.stringify({ event: 'started', port: config.PORT, provider: ctx.provider.name, model: ctx.provider.model }));
}

main().catch((err) => {
  console.error(JSON.stringify({ event: 'startup_failed', error: (err as Error).message }));
  process.exit(1);
});
