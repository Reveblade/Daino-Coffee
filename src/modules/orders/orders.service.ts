import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CollectionMethod,
  Order,
  OrderChannel,
  OrderDocument,
  OrderHistoryEntry,
} from './schemas/order.schema';
import { ShopSettingsService } from '../shop-settings/shop-settings.service';
import { TablesService } from '../tables/tables.service';
import { MenuService } from '../menu/menu.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/schemas/user.schema';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

const IN_PLACE = {
  PLACED: 'PLACED',
  IN_PROGRESS: 'IN_PROGRESS',
  READY: 'READY',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

const ONLINE = {
  PLACED: 'PLACED',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  READY_FOR_HANDOFF: 'READY_FOR_HANDOFF',
  ASSIGNED: 'ASSIGNED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  AWAITING_CASHIER_PAYMENT: 'AWAITING_CASHIER_PAYMENT',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly shopSettings: ShopSettingsService,
    private readonly tablesService: TablesService,
    private readonly menuService: MenuService,
    private readonly usersService: UsersService,
  ) {}

  private pushHistory(
    order: OrderDocument,
    entry: Omit<OrderHistoryEntry, 'at'> & { at?: Date },
  ) {
    order.history.push({
      at: entry.at ?? new Date(),
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      from: entry.from,
      to: entry.to,
      note: entry.note,
      metadata: entry.metadata,
    });
  }

  private actorRef(actor: JwtPayload) {
    return {
      actorId: new Types.ObjectId(actor.sub),
      actorRole: actor.role,
    };
  }

  private ensureStaff(actor: JwtPayload) {
    if (
      ![UserRole.ADMIN_OWNER, UserRole.ADMIN, UserRole.CASHIER].includes(
        actor.role,
      )
    ) {
      throw new ForbiddenException();
    }
  }

  async createInPlace(
    actor: JwtPayload,
    tableSlug: string,
    items: { productId: string; quantity?: number }[],
  ) {
    if (actor.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Customers only');
    }
    if (!(await this.shopSettings.acceptsTableOrders())) {
      throw new ForbiddenException('Self-service: table orders disabled');
    }
    const table = await this.tablesService.findBySlug(tableSlug);
    if (!table || table.number === 0) {
      throw new BadRequestException('Invalid table for ordering');
    }
    const { lineItems, total } = await this.buildLineItems(items);
    const order = await this.orderModel.create({
      channel: OrderChannel.IN_PLACE,
      status: IN_PLACE.PLACED,
      customerId: new Types.ObjectId(actor.sub),
      tableId: table._id,
      items: lineItems,
      totalKurus: total,
      history: [],
    });
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: undefined,
      to: IN_PLACE.PLACED,
      note: 'In-place order created',
      metadata: { tableNumber: table.number },
    });
    await order.save();
    return order;
  }

  async createOnline(
    actor: JwtPayload,
    body: {
      items: { productId: string; quantity?: number }[];
      addressIndex: number;
    },
  ) {
    if (actor.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Customers only');
    }
    const user = await this.usersService.findById(actor.sub);
    if (!user) {
      throw new NotFoundException();
    }
    const addr = user.addresses[body.addressIndex];
    if (!addr) {
      throw new BadRequestException('Invalid address index');
    }
    const { lineItems, total } = await this.buildLineItems(body.items);
    const order = await this.orderModel.create({
      channel: OrderChannel.ONLINE,
      status: ONLINE.PLACED,
      customerId: user._id,
      deliveryAddress: {
        label: addr.label,
        line1: addr.line1,
        line2: addr.line2,
        city: addr.city,
        district: addr.district,
        country: addr.country,
      },
      items: lineItems,
      totalKurus: total,
      history: [],
    });
    this.pushHistory(order, {
      ...this.actorRef(actor),
      to: ONLINE.PLACED,
      note: 'Online order created',
    });
    await order.save();
    return order;
  }

  private async buildLineItems(
    items: { productId: string; quantity?: number }[],
  ): Promise<{
    lineItems: {
      productId: Types.ObjectId;
      name: string;
      quantity: number;
      unitPriceKurus: number;
    }[];
    total: number;
  }> {
    if (!items?.length) {
      throw new BadRequestException('items required');
    }
    const lineItems: {
      productId: Types.ObjectId;
      name: string;
      quantity: number;
      unitPriceKurus: number;
    }[] = [];
    let total = 0;
    for (const it of items) {
      const p = await this.menuService.getProductForOrder(it.productId);
      const qty = Math.min(Math.max(it.quantity ?? 1, 1), 99);
      lineItems.push({
        productId: p._id,
        name: p.name,
        quantity: qty,
        unitPriceKurus: p.priceKurus,
      });
      total += p.priceKurus * qty;
    }
    return { lineItems, total };
  }

  async listOrders(
    actor: JwtPayload,
    query: {
      channel?: OrderChannel;
      status?: string;
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    if (actor.role === UserRole.COURIER) {
      throw new ForbiddenException('Use courier endpoints');
    }
    if (
      ![UserRole.ADMIN_OWNER, UserRole.ADMIN, UserRole.CASHIER].includes(
        actor.role,
      )
    ) {
      throw new ForbiddenException();
    }
    const filter: Record<string, unknown> = {};
    if (query.channel) {
      filter.channel = query.channel;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) {
        (filter.createdAt as Record<string, Date>).$gte = new Date(query.from);
      }
      if (query.to) {
        (filter.createdAt as Record<string, Date>).$lte = new Date(query.to);
      }
    }
    const limit = Math.min(query.limit ?? 50, 200);
    return this.orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async getOrder(actor: JwtPayload, id: string): Promise<OrderDocument> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException();
    }
    if (actor.role === UserRole.CUSTOMER) {
      if (!order.customerId.equals(new Types.ObjectId(actor.sub))) {
        throw new ForbiddenException();
      }
      return order;
    }
    if (actor.role === UserRole.COURIER) {
      if (!order.assignedCourierId?.equals(new Types.ObjectId(actor.sub))) {
        throw new ForbiddenException();
      }
      return order;
    }
    this.ensureStaff(actor);
    return order;
  }

  async inPlaceTransition(
    actor: JwtPayload,
    id: string,
    action: 'START' | 'READY' | 'AWAIT_PAYMENT' | 'MARK_PAID' | 'CANCEL',
  ) {
    this.ensureStaff(actor);
    const order = await this.orderModel.findById(id).exec();
    if (!order || order.channel !== OrderChannel.IN_PLACE) {
      throw new NotFoundException();
    }
    const prev = order.status;
    let next = prev;
    if (action === 'CANCEL') {
      if ([IN_PLACE.PAID, IN_PLACE.CANCELLED].includes(prev as never)) {
        throw new BadRequestException('Invalid transition');
      }
      next = IN_PLACE.CANCELLED;
    } else if (action === 'START') {
      if (prev !== IN_PLACE.PLACED) {
        throw new BadRequestException('Invalid transition');
      }
      next = IN_PLACE.IN_PROGRESS;
    } else if (action === 'READY') {
      if (prev !== IN_PLACE.IN_PROGRESS) {
        throw new BadRequestException('Invalid transition');
      }
      next = IN_PLACE.READY;
    } else if (action === 'AWAIT_PAYMENT') {
      if (prev !== IN_PLACE.READY) {
        throw new BadRequestException('Invalid transition');
      }
      next = IN_PLACE.AWAITING_PAYMENT;
    } else if (action === 'MARK_PAID') {
      if (
        ![IN_PLACE.READY, IN_PLACE.AWAITING_PAYMENT].includes(prev as never)
      ) {
        throw new BadRequestException('Invalid transition');
      }
      next = IN_PLACE.PAID;
    }
    order.status = next;
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: next,
      note: action,
    });
    await order.save();
    return order;
  }

  async onlineTransition(
    actor: JwtPayload,
    id: string,
    action: 'CONFIRM' | 'START_PREP' | 'READY_HANDOFF' | 'CANCEL' | 'MARK_PAID',
  ) {
    this.ensureStaff(actor);
    const order = await this.orderModel.findById(id).exec();
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException();
    }
    const prev = order.status;
    let next = prev;
    if (action === 'CANCEL') {
      if ([ONLINE.PAID, ONLINE.CANCELLED].includes(prev as never)) {
        throw new BadRequestException('Invalid transition');
      }
      next = ONLINE.CANCELLED;
    } else if (action === 'CONFIRM') {
      if (prev !== ONLINE.PLACED) {
        throw new BadRequestException('Invalid transition');
      }
      next = ONLINE.CONFIRMED;
    } else if (action === 'START_PREP') {
      if (prev !== ONLINE.CONFIRMED) {
        throw new BadRequestException('Invalid transition');
      }
      next = ONLINE.IN_PROGRESS;
    } else if (action === 'READY_HANDOFF') {
      if (prev !== ONLINE.IN_PROGRESS) {
        throw new BadRequestException('Invalid transition');
      }
      next = ONLINE.READY_FOR_HANDOFF;
    } else if (action === 'MARK_PAID') {
      if (prev !== ONLINE.AWAITING_CASHIER_PAYMENT) {
        throw new BadRequestException('Invalid transition');
      }
      next = ONLINE.PAID;
    }
    order.status = next;
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: next,
      note: action,
    });
    await order.save();
    return order;
  }

  async assignCourier(actor: JwtPayload, id: string, courierUserId: string) {
    this.ensureStaff(actor);
    const courier = await this.usersService.findById(courierUserId);
    if (!courier || courier.role !== UserRole.COURIER || !courier.isActive) {
      throw new BadRequestException('Invalid courier');
    }
    const order = await this.orderModel.findById(id).exec();
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException();
    }
    if (order.status !== ONLINE.READY_FOR_HANDOFF) {
      throw new BadRequestException('Order not ready for handoff');
    }
    const prev = order.status;
    order.status = ONLINE.ASSIGNED;
    order.assignedCourierId = courier._id;
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: ONLINE.ASSIGNED,
      metadata: { courierId: courier._id.toString() },
    });
    await order.save();
    return order;
  }

  async courierStartDelivery(actor: JwtPayload, id: string) {
    const order = await this.orderModel.findById(id).exec();
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException();
    }
    if (!order.assignedCourierId?.equals(new Types.ObjectId(actor.sub))) {
      throw new ForbiddenException();
    }
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException();
    }
    if (order.status !== ONLINE.ASSIGNED) {
      throw new BadRequestException('Invalid transition');
    }
    const prev = order.status;
    order.status = ONLINE.OUT_FOR_DELIVERY;
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: ONLINE.OUT_FOR_DELIVERY,
    });
    await order.save();
    return order;
  }

  async courierDeliver(
    actor: JwtPayload,
    id: string,
    method: CollectionMethod,
  ) {
    const order = await this.orderModel.findById(id).exec();
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException();
    }
    if (!order.assignedCourierId?.equals(new Types.ObjectId(actor.sub))) {
      throw new ForbiddenException();
    }
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException();
    }
    if (order.status !== ONLINE.OUT_FOR_DELIVERY) {
      throw new BadRequestException('Invalid transition');
    }
    const prev = order.status;
    order.collectionMethod = method;
    order.status = ONLINE.DELIVERED;
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: ONLINE.DELIVERED,
      metadata: { collectionMethod: method },
    });
    if (method === CollectionMethod.POS) {
      order.status = ONLINE.PAID;
      this.pushHistory(order, {
        ...this.actorRef(actor),
        from: ONLINE.DELIVERED,
        to: ONLINE.PAID,
        note: 'POS payment',
      });
    } else {
      order.status = ONLINE.AWAITING_CASHIER_PAYMENT;
      this.pushHistory(order, {
        ...this.actorRef(actor),
        from: ONLINE.DELIVERED,
        to: ONLINE.AWAITING_CASHIER_PAYMENT,
        note: 'Cash collected by courier; awaiting cashier confirmation',
      });
    }
    await order.save();
    return order;
  }

  async courierCurrent(actor: JwtPayload) {
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException();
    }
    return this.orderModel
      .findOne({
        assignedCourierId: new Types.ObjectId(actor.sub),
        status: { $in: [ONLINE.ASSIGNED, ONLINE.OUT_FOR_DELIVERY] },
      })
      .sort({ updatedAt: -1 })
      .exec();
  }

  async courierHistory(actor: JwtPayload, limit = 50) {
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException();
    }
    return this.orderModel
      .find({
        assignedCourierId: new Types.ObjectId(actor.sub),
        status: { $in: [ONLINE.PAID, ONLINE.CANCELLED] },
      })
      .sort({ updatedAt: -1 })
      .limit(Math.min(limit, 200))
      .exec();
  }
}
