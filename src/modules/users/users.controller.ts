import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  isValidTurkishMobileE164,
  normalizeTurkishMobile,
} from '../../common/utils/phone.util';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from './schemas/user.schema';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { IsIn, IsOptional, IsString } from 'class-validator';

class CreateAddressDto {
  @IsString()
  label: string;

  @IsString()
  line1: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  country?: string;
}

class CreateStaffDto {
  @IsString()
  phone: string;

  @IsIn([UserRole.ADMIN, UserRole.CASHIER, UserRole.COURIER])
  role: UserRole.ADMIN | UserRole.CASHIER | UserRole.COURIER;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    const doc = await this.users.findById(user.sub);
    if (!doc) {
      return { user: null };
    }
    return {
      id: doc._id.toString(),
      phoneE164: doc.phoneE164,
      role: doc.role,
      addresses: doc.addresses,
      favoriteProductIds: doc.favoriteProductIds.map((id) => id.toString()),
    };
  }

  @Post('addresses')
  async addAddress(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAddressDto,
  ) {
    if (user.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException();
    }
    return this.users.addAddress(user.sub, dto);
  }

  @Delete('addresses/:index')
  async removeAddress(
    @CurrentUser() user: JwtPayload,
    @Param('index') index: string,
  ) {
    if (user.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException();
    }
    return this.users.removeAddress(user.sub, parseInt(index, 10));
  }

  @Post('favorites/:productId')
  async toggleFavorite(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
  ) {
    if (user.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException();
    }
    return this.users.toggleFavorite(user.sub, productId);
  }
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly users: UsersService) {}

  @Get('staff')
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  listStaff() {
    return this.users.listStaff();
  }

  @Get('couriers')
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN, UserRole.CASHIER)
  listCouriers() {
    return this.users.listActiveCouriers();
  }

  @Post('staff')
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  async createStaff(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CreateStaffDto,
  ) {
    if (dto.role === UserRole.ADMIN && actor.role !== UserRole.ADMIN_OWNER) {
      throw new ForbiddenException('Only owner can create admin accounts');
    }
    const phoneE164 = normalizeTurkishMobile(dto.phone);
    if (!isValidTurkishMobileE164(phoneE164)) {
      throw new BadRequestException('Invalid Turkish mobile');
    }
    return this.users.createStaffUser(phoneE164, dto.role);
  }

  @Delete('staff/:id')
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  async deleteStaff(@CurrentUser() actor: JwtPayload, @Param('id') id: string) {
    await this.users.deleteStaffIfAllowed(id, actor);
    return { ok: true };
  }
}
