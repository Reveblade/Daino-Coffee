import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ShopSettings,
  ShopSettingsSchema,
} from './schemas/shop-settings.schema';
import { ShopSettingsService } from './shop-settings.service';
import { ShopSettingsController } from './shop-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShopSettings.name, schema: ShopSettingsSchema },
    ]),
  ],
  providers: [ShopSettingsService],
  controllers: [ShopSettingsController],
  exports: [ShopSettingsService],
})
export class ShopSettingsModule {}
