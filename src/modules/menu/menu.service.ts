import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';
import {
  Product,
  ProductDocument,
  ProductOptionGroup,
} from './schemas/product.schema';
import { UploadsService } from '../uploads/uploads.service';
import { StoreRealtimeGateway } from '../store-realtime/store-realtime.gateway';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type MenuAdminPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

@Injectable()
export class MenuService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly uploads: UploadsService,
    private readonly storeRealtime: StoreRealtimeGateway,
  ) {}

  private sanitizeOptionGroups(
    groups?: ProductOptionGroup[] | null,
  ): ProductOptionGroup[] {
    if (!groups?.length) {
      return []
    }
    const gids = new Set<string>()
    const out: ProductOptionGroup[] = []
    for (const g of groups) {
      const gid = String(g?.id ?? '').trim()
      const glabel = String(g?.label ?? '').trim()
      if (!gid || !glabel) {
        throw new BadRequestException('Seçenek grubu id ve başlık zorunludur')
      }
      if (gids.has(gid)) {
        throw new BadRequestException(`Yinelenen seçenek grubu id: ${gid}`)
      }
      gids.add(gid)
      const kind = g.kind === 'SELECTABLE' || g.kind === 'SINGLE' ? g.kind : null
      if (!kind) {
        throw new BadRequestException(`Geçersiz seçenek türü: ${String(g?.kind)}`)
      }
      const choicesIn = Array.isArray(g.choices) ? g.choices : []
      if (!choicesIn.length) {
        throw new BadRequestException(`"${glabel}" grubunda en az bir seçenek olmalı`)
      }
      const cids = new Set<string>()
      const choices: { id: string; label: string; extraPriceKurus: number }[] = []
      for (const c of choicesIn) {
        const cid = String(c?.id ?? '').trim()
        const clabel = String(c?.label ?? '').trim()
        if (!cid || !clabel) {
          throw new BadRequestException('Seçenek id ve etiketi zorunludur')
        }
        if (cids.has(cid)) {
          throw new BadRequestException(`Yinelenen seçenek id (${glabel}): ${cid}`)
        }
        cids.add(cid)
        const rawExtra = Number((c as { extraPriceKurus?: unknown })?.extraPriceKurus)
        const extraPriceKurus =
          Number.isFinite(rawExtra) && rawExtra >= 0 ? Math.round(rawExtra) : 0
        choices.push({ id: cid, label: clabel, extraPriceKurus })
      }
      out.push({ id: gid, label: glabel, kind, choices })
    }
    return out
  }

  async publicMenuTree() {
    const categories = await this.categoryModel
      .find({ isActive: true })
      .sort({ sortIndex: 1, name: 1 })
      .lean()
      .exec();
    const products = await this.productModel
      .find({ isAvailable: true })
      .sort({ sortIndex: 1, name: 1 })
      .lean()
      .exec();
    return { categories, products };
  }

  async listCategoriesAdmin(
    opts?: { q?: string; page?: number; pageSize?: number },
  ): Promise<CategoryDocument[] | MenuAdminPage<CategoryDocument>> {
    const filter =
      opts?.q?.trim()
        ? {
            $or: [
              { name: new RegExp(escapeRegex(opts.q.trim()), 'i') },
              { description: new RegExp(escapeRegex(opts.q.trim()), 'i') },
            ],
          }
        : {};
    const sort = { sortIndex: 1 as const, name: 1 as const };
    const usePaging =
      opts != null &&
      Number.isFinite(opts.page) &&
      Number.isFinite(opts.pageSize) &&
      opts.page! >= 0 &&
      opts.pageSize! >= 1;
    if (!usePaging) {
      return this.categoryModel.find(filter).sort(sort).exec();
    }
    const page = Math.floor(Math.max(0, opts!.page!));
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts!.pageSize!)));
    const [total, items] = await Promise.all([
      this.categoryModel.countDocuments(filter).exec(),
      this.categoryModel
        .find(filter)
        .sort(sort)
        .skip(page * pageSize)
        .limit(pageSize)
        .exec(),
    ]);
    return { items, total, page, pageSize };
  }

  async createCategory(body: {
    name: string;
    description?: string;
    parentId?: string | null;
    sortIndex?: number;
    imageUrl?: string;
  }) {
    let parentId: Types.ObjectId | null = null;
    if (body.parentId) {
      const p = await this.categoryModel.findById(body.parentId).exec();
      if (!p) {
        throw new NotFoundException('Parent category not found');
      }
      parentId = p._id;
    }
    const created = await this.categoryModel.create({
      name: body.name,
      description: body.description,
      parentId,
      sortIndex: body.sortIndex ?? 0,
      imageUrl: body.imageUrl,
      isActive: true,
    });
    this.storeRealtime.notifyMenuChanged();
    return created;
  }

  async updateCategory(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      sortIndex: number;
      imageUrl: string;
      isActive: boolean;
      parentId: string | null;
    }>,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException();
    }
    const c = await this.categoryModel.findById(id).exec();
    if (!c) {
      throw new NotFoundException();
    }
    if (patch.parentId !== undefined) {
      if (patch.parentId === null || patch.parentId === '') {
        c.parentId = undefined;
      } else {
        if (patch.parentId === id) {
          throw new BadRequestException('Category cannot be its own parent');
        }
        const p = await this.categoryModel.findById(patch.parentId).exec();
        if (!p) {
          throw new NotFoundException('Parent category not found');
        }
        c.parentId = p._id;
      }
    }
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.description !== undefined) c.description = patch.description;
    if (patch.sortIndex !== undefined) c.sortIndex = patch.sortIndex;
    if (patch.imageUrl !== undefined) c.imageUrl = patch.imageUrl;
    if (patch.isActive !== undefined) c.isActive = patch.isActive;
    await c.save();
    this.storeRealtime.notifyMenuChanged();
    return c;
  }

  async deleteCategory(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException();
    }
    const children = await this.categoryModel
      .countDocuments({ parentId: new Types.ObjectId(id) })
      .exec();
    if (children > 0) {
      throw new BadRequestException('Remove subcategories first');
    }
    const prods = await this.productModel
      .countDocuments({ categoryId: id })
      .exec();
    if (prods > 0) {
      throw new BadRequestException('Remove or move products first');
    }
    const res = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException();
    }
    this.storeRealtime.notifyMenuChanged();
  }

  async listProductsAdmin(
    opts?: { q?: string; page?: number; pageSize?: number },
  ): Promise<ProductDocument[] | MenuAdminPage<ProductDocument>> {
    const filter: Record<string, unknown> = {};
    const q = opts?.q?.trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      const catHits = await this.categoryModel
        .find({
          $or: [{ name: rx }, { description: rx }],
        })
        .select('_id')
        .lean()
        .exec();
      const catIds = catHits.map((c) => c._id);
      const orBranches: Record<string, unknown>[] = [
        { name: rx },
        { description: rx },
      ];
      if (catIds.length) {
        orBranches.push({ categoryId: { $in: catIds } });
      }
      filter.$or = orBranches;
    }
    const sort = { sortIndex: 1 as const, name: 1 as const };
    const usePaging =
      opts != null &&
      Number.isFinite(opts.page) &&
      Number.isFinite(opts.pageSize) &&
      opts.page! >= 0 &&
      opts.pageSize! >= 1;
    if (!usePaging) {
      return this.productModel.find(filter).sort(sort).exec();
    }
    const page = Math.floor(Math.max(0, opts!.page!));
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts!.pageSize!)));
    const [total, items] = await Promise.all([
      this.productModel.countDocuments(filter).exec(),
      this.productModel
        .find(filter)
        .sort(sort)
        .skip(page * pageSize)
        .limit(pageSize)
        .exec(),
    ]);
    return { items, total, page, pageSize };
  }

  async createProduct(body: {
    categoryId: string
    name: string
    description?: string
    priceKurus: number
    images?: { url: string; publicId?: string }[]
    sortIndex?: number
    optionGroups?: ProductOptionGroup[]
  }) {
    const cat = await this.categoryModel.findById(body.categoryId).exec()
    if (!cat) {
      throw new NotFoundException('Category not found')
    }
    const optionGroups = this.sanitizeOptionGroups(body.optionGroups ?? null)
    const created = await this.productModel.create({
      categoryId: cat._id,
      name: body.name,
      description: body.description,
      priceKurus: body.priceKurus,
      images: body.images ?? [],
      sortIndex: body.sortIndex ?? 0,
      isAvailable: true,
      optionGroups,
    })
    this.storeRealtime.notifyMenuChanged();
    return created;
  }

  async updateProduct(
    id: string,
    patch: Partial<{
      name: string
      description: string
      priceKurus: number
      images: { url: string; publicId?: string }[]
      isAvailable: boolean
      sortIndex: number
      categoryId: string
      optionGroups: ProductOptionGroup[] | null
    }>,
  ) {
    const p = await this.productModel.findById(id).exec();
    if (!p) {
      throw new NotFoundException();
    }
    if (patch.categoryId) {
      const cat = await this.categoryModel.findById(patch.categoryId).exec();
      if (!cat) {
        throw new NotFoundException('Category not found');
      }
      p.categoryId = cat._id;
    }
    const rest = { ...patch } as Record<string, unknown>
    if (rest.optionGroups !== undefined) {
      p.optionGroups = this.sanitizeOptionGroups(
        (rest.optionGroups as ProductOptionGroup[] | null) ?? [],
      )
      delete rest.optionGroups
    }
    Object.assign(p, rest);
    await p.save();
    this.storeRealtime.notifyMenuChanged();
    return p;
  }

  async deleteProduct(id: string) {
    const res = await this.productModel.findById(id).exec();
    if (!res) {
      throw new NotFoundException();
    }
    for (const img of res.images ?? []) {
      if (img.publicId) {
        await this.uploads.deleteByPublicId(img.publicId);
      }
    }
    await this.productModel.deleteOne({ _id: res._id }).exec();
    this.storeRealtime.notifyMenuChanged();
  }

  async getProductForOrder(productId: string): Promise<ProductDocument> {
    const p = await this.productModel.findById(productId).exec();
    if (!p || !p.isAvailable) {
      throw new BadRequestException('Product unavailable');
    }
    return p;
  }
}
