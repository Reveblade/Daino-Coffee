import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

class CreateTableDto {
  @Type(() => Number)
  @IsNumber()
  number: number;

  @IsOptional()
  @IsString()
  label?: string;
}

@Controller()
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get('tables/public/:slug')
  async getBySlug(@Param('slug') slug: string) {
    const t = await this.tables.findBySlug(slug);
    if (!t) {
      return { found: false };
    }
    return {
      found: true,
      number: t.number,
      label: t.label,
      menuUrl: t.menuUrl,
      isStorefront: t.number === 0,
    };
  }

  @Get('admin/tables')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  listAdmin() {
    return this.tables.listAll();
  }

  @Post('admin/tables')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  create(@Body() dto: CreateTableDto) {
    return this.tables.createTable(dto.number, dto.label);
  }

  @Delete('admin/tables/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.tables.deleteTable(id);
  }

  @Post('admin/tables/:id/regenerate-qr')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  regenerate(@Param('id') id: string) {
    return this.tables.regenerateQr(id);
  }
}
