import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

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
}

export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ categoryId: 1, sortIndex: 1 });
