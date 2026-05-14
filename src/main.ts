import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  const origins = process.env.CORS_ORIGINS;
  app.enableCors({
    origin:
      origins && origins !== '*'
        ? origins.split(',').map((o) => o.trim())
        : true,
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
