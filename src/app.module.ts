import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.schema';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ShopSettingsModule } from './modules/shop-settings/shop-settings.module';
import { TablesModule } from './modules/tables/tables.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CourierModule } from './modules/courier/courier.module';
import { BootstrapModule } from './modules/bootstrap/bootstrap.module';
import { SmsModule } from './modules/sms/sms.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 200 }],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (c: ConfigService) => ({
        uri: c.getOrThrow<string>('mongodbUri'),
      }),
      inject: [ConfigService],
    }),
    SmsModule,
    UploadsModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ShopSettingsModule,
    TablesModule,
    MenuModule,
    OrdersModule,
    CourierModule,
    BootstrapModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
