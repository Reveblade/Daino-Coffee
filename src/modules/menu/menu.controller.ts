import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  IsIn,
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

class ProductOptionChoiceDto {
  @IsString()
  id: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  extraPriceKurus?: number;
}

class ProductOptionGroupDto {
  @IsString()
  id: string;

  @IsString()
  label: string;

  @IsIn(['SELECTABLE', 'SINGLE'])
  kind: 'SELECTABLE' | 'SINGLE';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductOptionChoiceDto)
  choices: ProductOptionChoiceDto[];
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductOptionGroupDto)
  optionGroups?: ProductOptionGroupDto[];
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductOptionGroupDto)
  optionGroups?: ProductOptionGroupDto[];
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
  adminCategories(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p =
      page !== undefined && page !== '' ? parseInt(page, 10) : Number.NaN;
    const ps =
      pageSize !== undefined && pageSize !== ''
        ? parseInt(pageSize, 10)
        : Number.NaN;
    const usePaging =
      Number.isFinite(p) && Number.isFinite(ps) && p >= 0 && ps >= 1;
    if (usePaging) {
      return this.menu.listCategoriesAdmin({ q, page: p, pageSize: ps });
    }
    return this.menu.listCategoriesAdmin(q ? { q } : undefined);
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
  adminProducts(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p =
      page !== undefined && page !== '' ? parseInt(page, 10) : Number.NaN;
    const ps =
      pageSize !== undefined && pageSize !== ''
        ? parseInt(pageSize, 10)
        : Number.NaN;
    const usePaging =
      Number.isFinite(p) && Number.isFinite(ps) && p >= 0 && ps >= 1;
    if (usePaging) {
      return this.menu.listProductsAdmin({ q, page: p, pageSize: ps });
    }
    return this.menu.listProductsAdmin(q ? { q } : undefined);
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
