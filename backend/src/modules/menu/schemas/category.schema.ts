import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'Category',
    required: false,
    default: undefined,
  })
  parentId?: Types.ObjectId | null;

  @Prop({ default: 0 })
  sortIndex: number;

  @Prop()
  imageUrl?: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const CategorySchema = SchemaFactory.createForClass(Category);

CategorySchema.index({ parentId: 1, sortIndex: 1 });
