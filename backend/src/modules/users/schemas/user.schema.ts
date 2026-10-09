import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum UserRole {
  ADMIN_OWNER = 'ADMIN_OWNER',
  ADMIN = 'ADMIN',
  CASHIER = 'CASHIER',
  COURIER = 'COURIER',
  CUSTOMER = 'CUSTOMER',
}

@Schema({ _id: false })
export class UserAddress {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  line1: string;

  @Prop()
  line2?: string;

  @Prop({ required: true })
  city: string;

  @Prop()
  district?: string;

  @Prop({ default: 'Türkiye' })
  country?: string;

  @Prop()
  formattedAddress?: string;

  @Prop()
  placeId?: string;

  @Prop()
  lat?: number;

  @Prop()
  lng?: number;
}

const UserAddressSchema = SchemaFactory.createForClass(UserAddress);

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  phoneE164: string;

  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ type: String, enum: UserRole, required: true })
  role: UserRole;

  @Prop({ default: true })
  deletable: boolean;

  @Prop({ default: false })
  roleLocked: boolean;

  /** Only used for ADMIN_OWNER password login */
  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ type: [UserAddressSchema], default: [] })
  addresses: UserAddress[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }], default: [] })
  favoriteProductIds: Types.ObjectId[];

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
