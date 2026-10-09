import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { ShopSettingsService } from '../shop-settings/shop-settings.service';
import { TablesService } from '../tables/tables.service';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly shopSettings: ShopSettingsService,
    private readonly tablesService: TablesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.shopSettings.getSingleton();
    await this.tablesService.ensureStorefrontTable();
    await this.tablesService.syncMenuUrlsToPublicBase();
    const ownerPhone = this.config.get<string>('owner.phoneE164');
    const ownerPassword = this.config.get<string>('owner.password');
    if (ownerPhone && ownerPassword) {
      await this.usersService.ensureOwnerUser(ownerPhone, ownerPassword);
      this.logger.log('Owner account ensured');
    } else {
      this.logger.warn(
        'OWNER_PASSWORD not set; skipping owner seed (owner login will not work until configured)',
      );
    }
  }
}
