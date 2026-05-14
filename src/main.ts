import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

/** Local Vite apps; merged in dev because shell/IDE env can override `.env` for `CORS_ORIGINS`. */
const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

function resolveCorsOrigin(): true | string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || raw.trim() === '*') {
    return true;
  }
  const fromEnv = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production') {
    return fromEnv;
  }
  return [...new Set([...fromEnv, ...LOCAL_DEV_ORIGINS])];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({
    origin: resolveCorsOrigin(),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'healthz', method: RequestMethod.GET }],
  });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Listening on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
