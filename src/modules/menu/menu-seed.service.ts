import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MenuService } from './menu.service';

/**
 * Seeds a small demo menu (categories, subcategories, products, no images)
 * when the database has no categories yet.
 */
@Injectable()
export class MenuSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MenuSeedService.name);

  constructor(private readonly menu: MenuService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfEmpty();
  }

  private async seedIfEmpty(): Promise<void> {
    const existing = await this.menu.listCategoriesAdmin();
    if (existing.length > 0) {
      return;
    }

    const drinks = await this.menu.createCategory({
      name: 'İçecekler',
      description: 'Sıcak ve soğuk içecekler',
      sortIndex: 0,
    });
    const snacks = await this.menu.createCategory({
      name: 'Atıştırmalıklar',
      description: 'Tatlı ve tuzlu',
      sortIndex: 1,
    });

    const coffee = await this.menu.createCategory({
      name: 'Kahveler',
      description: 'Espresso bazlı',
      parentId: String(drinks._id),
      sortIndex: 0,
    });
    const tea = await this.menu.createCategory({
      name: 'Çaylar',
      parentId: String(drinks._id),
      sortIndex: 1,
    });
    const cold = await this.menu.createCategory({
      name: 'Soğuk içecekler',
      parentId: String(drinks._id),
      sortIndex: 2,
    });

    const sweets = await this.menu.createCategory({
      name: 'Tatlılar',
      parentId: String(snacks._id),
      sortIndex: 0,
    });
    const savory = await this.menu.createCategory({
      name: 'Tuzlu atıştırmalıklar',
      parentId: String(snacks._id),
      sortIndex: 1,
    });

    const cid = (doc: { _id: unknown }) => String(doc._id);

    await this.menu.createProduct({
      categoryId: cid(coffee),
      name: 'Espresso',
      description: 'Tek shot',
      priceKurus: 6500,
      sortIndex: 0,
    });
    await this.menu.createProduct({
      categoryId: cid(coffee),
      name: 'Americano',
      priceKurus: 7500,
      sortIndex: 1,
    });
    await this.menu.createProduct({
      categoryId: cid(coffee),
      name: 'Latte',
      description: 'Süt köpüklü',
      priceKurus: 9500,
      sortIndex: 2,
    });
    await this.menu.createProduct({
      categoryId: cid(coffee),
      name: 'Cappuccino',
      priceKurus: 9000,
      sortIndex: 3,
    });

    await this.menu.createProduct({
      categoryId: cid(tea),
      name: 'Demlik çay',
      priceKurus: 4500,
      sortIndex: 0,
    });
    await this.menu.createProduct({
      categoryId: cid(tea),
      name: 'Earl Grey',
      priceKurus: 5500,
      sortIndex: 1,
    });
    await this.menu.createProduct({
      categoryId: cid(tea),
      name: 'Ihlamur',
      priceKurus: 5000,
      sortIndex: 2,
    });

    await this.menu.createProduct({
      categoryId: cid(cold),
      name: 'Ice Americano',
      priceKurus: 8500,
      sortIndex: 0,
    });
    await this.menu.createProduct({
      categoryId: cid(cold),
      name: 'Limonata',
      description: 'Ev yapımı',
      priceKurus: 7000,
      sortIndex: 1,
    });
    await this.menu.createProduct({
      categoryId: cid(cold),
      name: 'Soğuk sütlü kahve',
      priceKurus: 10000,
      sortIndex: 2,
    });

    await this.menu.createProduct({
      categoryId: cid(sweets),
      name: 'Cheesecake',
      priceKurus: 12000,
      sortIndex: 0,
    });
    await this.menu.createProduct({
      categoryId: cid(sweets),
      name: 'Brownie',
      priceKurus: 8500,
      sortIndex: 1,
    });
    await this.menu.createProduct({
      categoryId: cid(sweets),
      name: 'Kurabiye tabağı',
      priceKurus: 6500,
      sortIndex: 2,
    });

    await this.menu.createProduct({
      categoryId: cid(savory),
      name: 'Tuzlu kurabiye',
      priceKurus: 5500,
      sortIndex: 0,
    });
    await this.menu.createProduct({
      categoryId: cid(savory),
      name: 'Sandviç (tavuk)',
      description: 'Tam buğday',
      priceKurus: 14500,
      sortIndex: 1,
    });

    this.logger.log('Demo menu seed applied (categories + products, no images)');
  }
}
