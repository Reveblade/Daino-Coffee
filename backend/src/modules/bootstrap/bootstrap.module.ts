import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { UsersModule } from '../users/users.module';
import { ShopSettingsModule } from '../shop-settings/shop-settings.module';
import { TablesModule } from '../tables/tables.module';

@Module({
  imports: [UsersModule, ShopSettingsModule, TablesModule],
  providers: [BootstrapService],
})
export class BootstrapModule {}
