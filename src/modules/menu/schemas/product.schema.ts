import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductOptionKind = 'SELECTABLE' | 'SINGLE';

export const PRODUCT_NAME_MAX_LENGTH = 120;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 500;
export const PRODUCT_OPTION_GROUP_LABEL_MAX_LENGTH = 80;
export const PRODUCT_OPTION_CHOICE_LABEL_MAX_LENGTH = 80;
export const PRODUCT_PRICE_MAX_KURUS = 9_999_999;
export const PRODUCT_OPTION_EXTRA_PRICE_MAX_KURUS = 999_999;

@Schema({ _id: false })
export class ProductOptionChoice {
  @Prop({ required: true })
  id: string;

  @Prop({
    required: true,
    trim: true,
    maxlength: PRODUCT_OPTION_CHOICE_LABEL_MAX_LENGTH,
  })
  label: string;

  /** Seçildiğinde ürün birim fiyatına eklenecek ek tutar (kuruş). */
  @Prop({ default: 0, min: 0, max: PRODUCT_OPTION_EXTRA_PRICE_MAX_KURUS })
  extraPriceKurus?: number;
}

const ProductOptionChoiceSchema =
  SchemaFactory.createForClass(ProductOptionChoice);

@Schema({ _id: false })
export class ProductOptionGroup {
  @Prop({ required: true })
  id: string;

  @Prop({
    required: true,
    trim: true,
    maxlength: PRODUCT_OPTION_GROUP_LABEL_MAX_LENGTH,
  })
  label: string;

  /** Birden fazla seçilebilir (örn. ekstra) veya tek seçim (örn. süt tipi). */
  @Prop({ required: true, enum: ['SELECTABLE', 'SINGLE'] })
  kind: ProductOptionKind;

  @Prop({ type: [ProductOptionChoiceSchema], default: [] })
  choices: ProductOptionChoice[];
}

const ProductOptionGroupSchema =
  SchemaFactory.createForClass(ProductOptionGroup);

export type ProductDocument = HydratedDocument<Product>;

@Schema({ timestamps: true })
export class Product {
  @Prop({ type: Types.ObjectId, ref: 'Category', required: true, index: true })
  categoryId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: PRODUCT_NAME_MAX_LENGTH })
  name: string;

  @Prop({ trim: true, maxlength: PRODUCT_DESCRIPTION_MAX_LENGTH })
  description?: string;

  /** Price in kuruş (integer) */
  @Prop({ required: true, min: 0, max: PRODUCT_PRICE_MAX_KURUS })
  priceKurus: number;

  @Prop({
    type: [
      {
        url: { type: String, required: true },
        publicId: { type: String },
      },
    ],
    default: [],
  })
  images: { url: string; publicId?: string }[];

  @Prop({ default: true })
  isAvailable: boolean;

  @Prop({ default: 0 })
  sortIndex: number;

  @Prop({ type: [ProductOptionGroupSchema], default: [] })
  optionGroups: ProductOptionGroup[];
}

export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ categoryId: 1, sortIndex: 1 });
