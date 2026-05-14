import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from './schemas/category.schema';
import { Product, ProductSchema } from './schemas/product.schema';
import { MenuService } from './menu.service';
import { MenuSeedService } from './menu-seed.service';
import { MenuController } from './menu.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  providers: [MenuService, MenuSeedService],
  controllers: [MenuController],
  exports: [MenuService],
})
export class MenuModule {}
