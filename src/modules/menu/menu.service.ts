import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';
import { Product, ProductDocument } from './schemas/product.schema';
import { UploadsService } from '../uploads/uploads.service';

@Injectable()
export class MenuService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly uploads: UploadsService,
  ) {}

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

  async listCategoriesAdmin() {
    return this.categoryModel.find().sort({ sortIndex: 1 }).exec();
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
    return this.categoryModel.create({
      name: body.name,
      description: body.description,
      parentId,
      sortIndex: body.sortIndex ?? 0,
      imageUrl: body.imageUrl,
      isActive: true,
    });
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
  }

  async listProductsAdmin() {
    return this.productModel.find().sort({ sortIndex: 1 }).exec();
  }

  async createProduct(body: {
    categoryId: string;
    name: string;
    description?: string;
    priceKurus: number;
    images?: { url: string; publicId?: string }[];
    sortIndex?: number;
  }) {
    const cat = await this.categoryModel.findById(body.categoryId).exec();
    if (!cat) {
      throw new NotFoundException('Category not found');
    }
    return this.productModel.create({
      categoryId: cat._id,
      name: body.name,
      description: body.description,
      priceKurus: body.priceKurus,
      images: body.images ?? [],
      sortIndex: body.sortIndex ?? 0,
      isAvailable: true,
    });
  }

  async updateProduct(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      priceKurus: number;
      images: { url: string; publicId?: string }[];
      isAvailable: boolean;
      sortIndex: number;
      categoryId: string;
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
    Object.assign(p, patch);
    await p.save();
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
  }

  async getProductForOrder(productId: string): Promise<ProductDocument> {
    const p = await this.productModel.findById(productId).exec();
    if (!p || !p.isAvailable) {
      throw new BadRequestException('Product unavailable');
    }
    return p;
  }
}
