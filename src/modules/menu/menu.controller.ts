import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ImageDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  publicId?: string;
}

class CreateCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsNumber()
  sortIndex?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

class CreateProductDto {
  @IsString()
  categoryId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  priceKurus: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @IsOptional()
  @IsNumber()
  sortIndex?: number;
}

class PatchCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsNumber()
  sortIndex?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class PatchProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceKurus?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsNumber()
  sortIndex?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;
}

@Controller()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('menu')
  publicMenu() {
    return this.menu.publicMenuTree();
  }

  @Get('admin/menu/categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  adminCategories() {
    return this.menu.listCategoriesAdmin();
  }

  @Post('admin/menu/categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.menu.createCategory(dto);
  }

  @Patch('admin/menu/categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  patchCategory(@Param('id') id: string, @Body() dto: PatchCategoryDto) {
    return this.menu.updateCategory(id, dto);
  }

  @Delete('admin/menu/categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  deleteCategory(@Param('id') id: string) {
    return this.menu.deleteCategory(id);
  }

  @Get('admin/menu/products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  adminProducts() {
    return this.menu.listProductsAdmin();
  }

  @Post('admin/menu/products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  createProduct(@Body() dto: CreateProductDto) {
    return this.menu.createProduct(dto);
  }

  @Patch('admin/menu/products/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  patchProduct(@Param('id') id: string, @Body() dto: PatchProductDto) {
    return this.menu.updateProduct(id, dto);
  }

  @Delete('admin/menu/products/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
  deleteProduct(@Param('id') id: string) {
    return this.menu.deleteProduct(id);
  }
}
