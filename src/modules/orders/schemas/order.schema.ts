import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole } from '../../users/schemas/user.schema';

export enum OrderChannel {
  IN_PLACE = 'IN_PLACE',
  ONLINE = 'ONLINE',
}

export enum CollectionMethod {
  CASH = 'CASH',
  POS = 'POS',
}

@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, min: 0 })
  unitPriceKurus: number;
}

const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ _id: false })
export class AddressSnapshot {
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
}

const AddressSnapshotSchema = SchemaFactory.createForClass(AddressSnapshot);

@Schema({ _id: false })
export class OrderHistoryEntry {
  @Prop({ type: Date, default: () => new Date() })
  at: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  @Prop({ type: String, enum: UserRole })
  actorRole?: UserRole;

  @Prop()
  from?: string;

  @Prop({ required: true })
  to: string;

  @Prop()
  note?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

const OrderHistoryEntrySchema = SchemaFactory.createForClass(OrderHistoryEntry);

export type OrderDocument = HydratedDocument<Order>;

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: String, enum: OrderChannel, required: true, index: true })
  channel: OrderChannel;

  @Prop({ required: true, index: true })
  status: string;

  /** Yalnızca web (ONLINE) siparişlerde dolu; QR masa siparişleri kullanıcıya bağlanmaz. */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  customerId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Table' })
  tableId?: Types.ObjectId;

  @Prop({ type: AddressSnapshotSchema })
  deliveryAddress?: AddressSnapshot;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({ required: true, min: 0 })
  totalKurus: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedCourierId?: Types.ObjectId;

  @Prop({ type: String, enum: CollectionMethod })
  collectionMethod?: CollectionMethod;

  @Prop({ type: [OrderHistoryEntrySchema], default: [] })
  history: OrderHistoryEntry[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ channel: 1, status: 1, createdAt: -1 });
