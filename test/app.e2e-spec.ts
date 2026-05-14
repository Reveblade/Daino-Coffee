import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  RequestMethod,
} from '@nestjs/common';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import helmet from 'helmet';

describe('App (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = 'test-jwt-secret-min-16-chars';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.MENU_PUBLIC_BASE_URL = 'https://menu.example.com';
    process.env.OWNER_PHONE_E164 = '+905551112233';
    process.env.OWNER_PASSWORD = 'ownerpassword12';
    process.env.CORS_ORIGINS = '*';
    process.env.NETGSM_OTP_DISABLED = 'true';

    const { AppModule } = await import('./../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(helmet());
    app.enableCors({ origin: true, credentials: true });
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
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('/healthz (GET)', () => {
    return request(app.getHttpServer()).get('/healthz').expect(200);
  });

  it('owner login returns JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/owner/login')
      .send({ phone: '+905551112233', password: 'ownerpassword12' })
      .expect(200);
    expect(res.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('GET /v1/shop/settings', () => {
    return request(app.getHttpServer())
      .get('/v1/shop/settings')
      .expect(200)
      .expect((res) => {
        expect(res.body.serviceEnabled).toBe(false);
      });
  });
});
