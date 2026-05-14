import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductOptionKind = 'SELECTABLE' | 'SINGLE';

@Schema({ _id: false })
export class ProductOptionChoice {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  label: string;

  /** Seçildiğinde ürün birim fiyatına eklenecek ek tutar (kuruş). */
  @Prop({ default: 0, min: 0 })
  extraPriceKurus?: number;
}

const ProductOptionChoiceSchema = SchemaFactory.createForClass(ProductOptionChoice);

@Schema({ _id: false })
export class ProductOptionGroup {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  label: string;

  /** Birden fazla seçilebilir (örn. ekstra) veya tek seçim (örn. süt tipi). */
  @Prop({ required: true, enum: ['SELECTABLE', 'SINGLE'] })
  kind: ProductOptionKind;

  @Prop({ type: [ProductOptionChoiceSchema], default: [] })
  choices: ProductOptionChoice[];
}

const ProductOptionGroupSchema = SchemaFactory.createForClass(ProductOptionGroup);

export type ProductDocument = HydratedDocument<Product>;

@Schema({ timestamps: true })
export class Product {
  @Prop({ type: Types.ObjectId, ref: 'Category', required: true, index: true })
  categoryId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  /** Price in kuruş (integer) */
  @Prop({ required: true, min: 0 })
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
