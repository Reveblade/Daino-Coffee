import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ShopSettingsDocument = HydratedDocument<ShopSettings>;

@Schema({ timestamps: true, collection: 'shopsettings' })
export class ShopSettings {
  @Prop({ default: false })
  serviceEnabled: boolean;
}

export const ShopSettingsSchema = SchemaFactory.createForClass(ShopSettings);
