import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { randomUUID } from 'crypto';

export type TableDocument = HydratedDocument<Table>;

@Schema({ timestamps: true })
export class Table {
  @Prop({ required: true, unique: true, index: true })
  number: number;

  @Prop()
  label?: string;

  @Prop({ required: true, unique: true, index: true })
  publicSlug: string;

  @Prop({ required: true })
  menuUrl: string;

  @Prop()
  qrImageUrl?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isSystem: boolean;
}

export const TableSchema = SchemaFactory.createForClass(Table);

export function generateTableSlug(): string {
  return randomUUID().replace(/-/g, '');
}
