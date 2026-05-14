import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ShopSettingsService } from './shop-settings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { IsBoolean } from 'class-validator';

class PatchShopDto {
  @IsBoolean()
  serviceEnabled: boolean;
}

@Controller('shop')
export class ShopSettingsController {
  constructor(private readonly shopSettings: ShopSettingsService) {}

  /** Public: menu clients need service flag */
  @Get('settings')
  async publicSettings() {
    const s = await this.shopSettings.getSingleton();
    return {
      serviceEnabled: s.serviceEnabled,
      mode: s.serviceEnabled ? 'SERVICE' : 'SELF_SERVICE',
      acceptsOrders: s.serviceEnabled,
    };
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN, UserRole.CASHIER)
  async patchSettings(@Body() dto: PatchShopDto) {
    const s = await this.shopSettings.setServiceEnabled(dto.serviceEnabled);
    return {
      serviceEnabled: s.serviceEnabled,
      mode: s.serviceEnabled ? 'SERVICE' : 'SELF_SERVICE',
      acceptsOrders: s.serviceEnabled,
    };
  }
}
