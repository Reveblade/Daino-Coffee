import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  CollectionMethod,
  Order,
  OrderChannel,
  OrderDocument,
  OrderHistoryEntry,
} from './schemas/order.schema'
import { ProductDocument } from '../menu/schemas/product.schema'
import { ShopSettingsService } from '../shop-settings/shop-settings.service'
import { TablesService } from '../tables/tables.service'
import { MenuService } from '../menu/menu.service'
import { UsersService } from '../users/users.service'
import { UserRole } from '../users/schemas/user.schema'
import { JwtPayload } from '../auth/strategies/jwt.strategy'
import { OrdersStaffRealtimeGateway } from '../orders-realtime/orders-staff-realtime.gateway'

const IN_PLACE = {
  PLACED: 'PLACED',
  IN_PROGRESS: 'IN_PROGRESS',
  READY: 'READY',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const

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
} as const

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly shopSettings: ShopSettingsService,
    private readonly tablesService: TablesService,
    private readonly menuService: MenuService,
    private readonly usersService: UsersService,
    private readonly ordersStaffRealtime: OrdersStaffRealtimeGateway,
  ) { }

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
    })
  }

  private actorRef(actor: JwtPayload) {
    return {
      actorId: new Types.ObjectId(actor.sub),
      actorRole: actor.role,
    }
  }

  private ensureStaff(actor: JwtPayload) {
    if (
      ![UserRole.ADMIN_OWNER, UserRole.ADMIN, UserRole.CASHIER].includes(
        actor.role,
      )
    ) {
      throw new ForbiddenException()
    }
  }

  private ensureAdmin(actor: JwtPayload) {
    if (![UserRole.ADMIN_OWNER, UserRole.ADMIN].includes(actor.role)) {
      throw new ForbiddenException()
    }
  }

  private cashierHistorySince(): Date {
    return new Date(Date.now() - 24 * 60 * 60 * 1000)
  }

  /** Kasiyer yalnızca son 24 saatte kapanan (ödeme/iptal) sipariş geçmişini görebilir. */
  private assertCashierCanViewClosedOrder(
    order: OrderDocument,
    actor: JwtPayload,
  ) {
    if (actor.role !== UserRole.CASHIER) return
    if (order.status !== 'PAID' && order.status !== 'CANCELLED') return
    const u =
      (order.get('updatedAt') as Date | undefined) ??
      (order.get('createdAt') as Date | undefined)
    if (u && u < this.cashierHistorySince()) {
      throw new ForbiddenException()
    }
  }

  private stableOptionKey(
    s?: {
      groupId: string
      selectedChoices?: { id: string }[]
    }[],
  ): string {
    if (!s?.length) return ''
    return JSON.stringify(
      [...s]
        .sort((a, b) => a.groupId.localeCompare(b.groupId))
        .map((g) => ({
          g: g.groupId,
          c: [...(g.selectedChoices ?? [])]
            .map((x) => x.id)
            .sort(),
        })),
    )
  }

  private formatOptionsLine(
    s?: {
      groupLabel?: string
      groupId: string
      selectedChoices?: { label: string; extraPriceKurus?: number }[]
    }[],
  ): string | undefined {
    if (!s?.length) return undefined
    const t = s
      .map((g) => {
        const labels = g.selectedChoices
          ?.map((c) => {
            const extra = Number(c.extraPriceKurus) || 0
            const px =
              extra > 0
                ? ` (+${(extra / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺)`
                : ''
            return `${c.label}${px}`
          })
          .join(', ')
        if (!labels) return null
        return `${g.groupLabel ?? g.groupId}: ${labels}`
      })
      .filter(Boolean)
      .join(' | ')
    return t || undefined
  }

  private buildOptionSnapshots(
    product: ProductDocument,
    raw?: { groupId: string; selectedChoiceIds?: string[] }[],
  ): {
    groupId: string
    groupLabel?: string
    kind: string
    selectedChoices: { id: string; label: string; extraPriceKurus: number }[]
  }[] {
    const groups = product.optionGroups ?? []
    const map = new Map(groups.map((g) => [g.id, g]))
    if (!raw?.length) {
      return []
    }
    const seenG = new Set<string>()
    const out: {
      groupId: string
      groupLabel?: string
      kind: string
      selectedChoices: { id: string; label: string; extraPriceKurus: number }[]
    }[] = []
    for (const entry of raw) {
      if (!entry?.groupId?.trim()) {
        throw new BadRequestException('Geçersiz seçenek grubu')
      }
      if (seenG.has(entry.groupId)) {
        throw new BadRequestException('Yinelenen seçenek grubu')
      }
      seenG.add(entry.groupId)
      const g = map.get(entry.groupId)
      if (!g) {
        throw new BadRequestException('Bilinmeyen seçenek grubu')
      }
      const ids = Array.isArray(entry.selectedChoiceIds)
        ? [
            ...new Set(
              entry.selectedChoiceIds
                .map((x) => String(x).trim())
                .filter(Boolean),
            ),
          ]
        : []
      if (g.kind === 'SINGLE' && ids.length > 1) {
        throw new BadRequestException(`${g.label}: yalnızca bir seçim yapılabilir`)
      }
      const choiceMap = new Map(g.choices.map((c) => [c.id, c]))
      const selectedChoices = ids.map((id) => {
        const c = choiceMap.get(id)
        if (!c) {
          throw new BadRequestException(`Geçersiz seçim: ${g.label}`)
        }
        const extra = Number((c as { extraPriceKurus?: unknown }).extraPriceKurus)
        const extraPriceKurus =
          Number.isFinite(extra) && extra >= 0 ? Math.round(extra) : 0
        return { id: c.id, label: c.label, extraPriceKurus }
      })
      out.push({
        groupId: g.id,
        groupLabel: g.label,
        kind: g.kind,
        selectedChoices,
      })
    }
    return out.sort((a, b) => a.groupId.localeCompare(b.groupId))
  }

  private sumOptionExtrasKurus(
    snapshots: { selectedChoices: { extraPriceKurus?: number }[] }[],
  ): number {
    let sum = 0
    for (const g of snapshots) {
      for (const c of g.selectedChoices ?? []) {
        sum += Number(c.extraPriceKurus) || 0
      }
    }
    return sum
  }

  async createInPlace(
    tableSlug: string,
    items: {
      productId: string
      quantity?: number
      options?: { groupId: string; selectedChoiceIds?: string[] }[]
    }[],
  ) {
    if (!(await this.shopSettings.acceptsTableOrders())) {
      throw new ForbiddenException('Self-service: table orders disabled')
    }
    const table = await this.tablesService.findBySlug(tableSlug)
    if (!table || table.number === 0) {
      throw new BadRequestException('Invalid table for ordering')
    }
    const { lineItems, total } = await this.buildLineItems(items)
    const appended = await this.tryAppendToOpenInPlaceOrder(
      table._id,
      table.number,
      lineItems,
    )
    if (appended) {
      this.ordersStaffRealtime.notifyOrdersChanged()
      return { ...appended.toObject(), augmented: true }
    }
    const order = await this.orderModel.create({
      channel: OrderChannel.IN_PLACE,
      status: IN_PLACE.PLACED,
      tableId: table._id,
      items: lineItems,
      totalKurus: total,
      history: [],
    })
    this.pushHistory(order, {
      from: undefined,
      to: IN_PLACE.PLACED,
      note: 'In-place order created',
      metadata: { tableNumber: table.number },
    })
    await order.save()
    this.ordersStaffRealtime.notifyOrdersChanged()
    return { ...order.toObject(), augmented: false }
  }

  private mergeInPlaceLineItems(
    existing: {
      productId: Types.ObjectId
      name: string
      quantity: number
      unitPriceKurus: number
      optionSelections?: {
        groupId: string
        groupLabel?: string
        kind: string
        selectedChoices: { id: string; label: string; extraPriceKurus?: number }[]
      }[]
    }[],
    additions: {
      productId: Types.ObjectId
      name: string
      quantity: number
      unitPriceKurus: number
      optionSelections?: {
        groupId: string
        groupLabel?: string
        kind: string
        selectedChoices: { id: string; label: string; extraPriceKurus?: number }[]
      }[]
    }[],
  ) {
    const mapChoice = (c: {
      id: string
      label: string
      extraPriceKurus?: number
    }) => ({
      id: c.id,
      label: c.label,
      extraPriceKurus: Number(c.extraPriceKurus) || 0,
    })
    const result = existing.map((it) => ({
      productId: new Types.ObjectId(it.productId),
      name: it.name,
      quantity: it.quantity,
      unitPriceKurus: it.unitPriceKurus,
      optionSelections: it.optionSelections?.length
        ? it.optionSelections.map((s) => ({
            groupId: s.groupId,
            groupLabel: s.groupLabel,
            kind: s.kind,
            selectedChoices: s.selectedChoices.map(mapChoice),
          }))
        : undefined,
    }))
    for (const add of additions) {
      const k = String(add.productId)
      const addKey = this.stableOptionKey(add.optionSelections)
      const idx = result.findIndex(
        (x) =>
          String(x.productId) === k &&
          this.stableOptionKey(x.optionSelections) === addKey,
      )
      if (idx >= 0) {
        result[idx] = {
          productId: result[idx].productId,
          name: add.name,
          quantity: Math.min(result[idx].quantity + add.quantity, 99),
          unitPriceKurus: add.unitPriceKurus,
          optionSelections: result[idx].optionSelections?.length
            ? result[idx].optionSelections!.map((s) => ({
                groupId: s.groupId,
                groupLabel: s.groupLabel,
                kind: s.kind,
                selectedChoices: s.selectedChoices.map(mapChoice),
              }))
            : undefined,
        }
      } else {
        result.push({
          productId: add.productId,
          name: add.name,
          quantity: add.quantity,
          unitPriceKurus: add.unitPriceKurus,
          optionSelections: add.optionSelections?.length
            ? add.optionSelections.map((s) => ({
                groupId: s.groupId,
                groupLabel: s.groupLabel,
                kind: s.kind,
                selectedChoices: s.selectedChoices.map(mapChoice),
              }))
            : undefined,
        })
      }
    }
    return result
  }

  private totalKurusFromItems(
    items: {
      unitPriceKurus: number
      quantity: number
    }[],
  ) {
    return items.reduce((s, i) => s + i.unitPriceKurus * i.quantity, 0)
  }

  /**
   * Ödeme veya iptal olmayan aynı masanın siparişine ürün ekler (eşzamanlı yazım için updatedAt ile yeniden dener).
   */
  private async tryAppendToOpenInPlaceOrder(
    tableId: Types.ObjectId,
    tableNumber: number,
    additions: {
      productId: Types.ObjectId
      name: string
      quantity: number
      unitPriceKurus: number
      optionSelections?: {
        groupId: string
        groupLabel?: string
        kind: string
        selectedChoices: { id: string; label: string; extraPriceKurus?: number }[]
      }[]
    }[],
  ): Promise<OrderDocument | null> {
    const addedMeta = additions.map((a) => ({
      name: a.name,
      quantity: a.quantity,
      unitPriceKurus: a.unitPriceKurus,
      optionsLine: this.formatOptionsLine(a.optionSelections),
    }))
    const maxAttempts = 12
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const open = await this.orderModel
        .findOne({
          channel: OrderChannel.IN_PLACE,
          tableId,
          status: { $nin: [IN_PLACE.PAID, IN_PLACE.CANCELLED] },
        })
        .sort({ createdAt: 1 })
        .exec()
      if (!open) {
        return null
      }
      const merged = this.mergeInPlaceLineItems(
        open.items as {
          productId: Types.ObjectId
          name: string
          quantity: number
          unitPriceKurus: number
          optionSelections?: {
            groupId: string
            groupLabel?: string
            kind: string
            selectedChoices: { id: string; label: string; extraPriceKurus?: number }[]
          }[]
        }[],
        additions,
      )
      const newTotal = this.totalKurusFromItems(merged)
      const previousTotal = open.totalKurus
      const stamp = (open as OrderDocument & { updatedAt?: Date }).updatedAt
      const nextStatus = [IN_PLACE.READY, IN_PLACE.AWAITING_PAYMENT].includes(
        open.status as never,
      )
        ? IN_PLACE.IN_PROGRESS
        : open.status
      const historyEntry = {
        at: new Date(),
        from: open.status,
        to: nextStatus,
        note: 'IN_PLACE_ITEMS_ADDED',
        metadata: {
          tableNumber,
          addedItems: addedMeta,
          previousTotalKurus: previousTotal,
          newTotalKurus: newTotal,
        },
      }
      const res = await this.orderModel.updateOne(
        { _id: open._id, updatedAt: stamp },
        {
          $set: {
            items: merged,
            totalKurus: newTotal,
            status: nextStatus,
          },
          $push: { history: historyEntry },
        },
      )
      if (res.modifiedCount === 1) {
        const fresh = await this.orderModel
          .findById(open._id)
          .populate({ path: 'tableId', select: 'number label publicSlug' })
          .exec()
        return fresh
      }
    }
    throw new ConflictException(
      'Masa siparişi güncellenemedi; lütfen bir kez daha deneyin.',
    )
  }

  async createOnline(
    actor: JwtPayload,
    body: {
      items: {
        productId: string
        quantity?: number
        options?: { groupId: string; selectedChoiceIds?: string[] }[]
      }[]
      addressIndex: number
    },
  ) {
    if (actor.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Customers only')
    }
    const user = await this.usersService.findById(actor.sub)
    if (!user) {
      throw new NotFoundException()
    }
    this.usersService.assertCustomerAccountComplete(user)
    const addr = user.addresses[body.addressIndex]
    if (!addr) {
      throw new BadRequestException('Invalid address index')
    }
    if (!this.usersService.isDeliveryAddressSupported(addr)) {
      throw new BadRequestException(
        'Web siparişi için teslimat adresi Akhisar içinde olmalıdır.',
      )
    }
    const { lineItems, total } = await this.buildLineItems(body.items)
    const order = await this.orderModel.create({
      channel: OrderChannel.ONLINE,
      status: ONLINE.PLACED,
      customerId: user._id,
      deliveryRecipient: {
        firstName: user.firstName,
        lastName: user.lastName,
        phoneE164: user.phoneE164,
      },
      deliveryAddress: {
        label: addr.label,
        line1: addr.line1,
        line2: addr.line2,
        city: addr.city,
        district: addr.district,
        country: addr.country,
        formattedAddress: addr.formattedAddress,
        placeId: addr.placeId,
        lat: addr.lat,
        lng: addr.lng,
      },
      items: lineItems,
      totalKurus: total,
      history: [],
    })
    this.pushHistory(order, {
      ...this.actorRef(actor),
      to: ONLINE.PLACED,
      note: 'Online order created',
    })
    await order.save()
    this.ordersStaffRealtime.notifyOrdersChanged()
    return order
  }

  private async buildLineItems(
    items: {
      productId: string
      quantity?: number
      options?: { groupId: string; selectedChoiceIds?: string[] }[]
    }[],
  ): Promise<{
    lineItems: {
      productId: Types.ObjectId
      name: string
      quantity: number
      unitPriceKurus: number
      optionSelections?: {
        groupId: string
        groupLabel?: string
        kind: string
        selectedChoices: { id: string; label: string; extraPriceKurus?: number }[]
      }[]
    }[]
    total: number
  }> {
    if (!items?.length) {
      throw new BadRequestException('items required')
    }
    const lineItems: {
      productId: Types.ObjectId
      name: string
      quantity: number
      unitPriceKurus: number
      optionSelections?: {
        groupId: string
        groupLabel?: string
        kind: string
        selectedChoices: { id: string; label: string; extraPriceKurus?: number }[]
      }[]
    }[] = []
    let total = 0
    for (const it of items) {
      const p = await this.menuService.getProductForOrder(it.productId)
      const qty = Math.min(Math.max(it.quantity ?? 1, 1), 99)
      const optionSnapshots = this.buildOptionSnapshots(p, it.options)
      const extras = this.sumOptionExtrasKurus(optionSnapshots)
      const unitPriceKurus = p.priceKurus + extras
      lineItems.push({
        productId: p._id,
        name: p.name,
        quantity: qty,
        unitPriceKurus,
        optionSelections: optionSnapshots.length ? optionSnapshots : undefined,
      })
      total += unitPriceKurus * qty
    }
    return { lineItems, total }
  }

  async listOrders(
    actor: JwtPayload,
    query: {
      channel?: OrderChannel
      status?: string
      from?: string
      to?: string
      limit?: number
      cursor?: string
    },
  ) {
    if (actor.role === UserRole.COURIER) {
      throw new ForbiddenException('Use courier endpoints')
    }
    if (actor.role === UserRole.CUSTOMER) {
      const filter: Record<string, unknown> = {
        customerId: new Types.ObjectId(actor.sub),
        channel: OrderChannel.ONLINE,
        status: { $nin: [ONLINE.PAID, ONLINE.CANCELLED] },
      }
      const limit = Math.min(query.limit ?? 30, 50)
      return this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .exec()
    }
    if (
      ![UserRole.ADMIN_OWNER, UserRole.ADMIN, UserRole.CASHIER].includes(
        actor.role,
      )
    ) {
      throw new ForbiddenException()
    }
    const filter: Record<string, unknown> = {}
    if (query.channel) {
      filter.channel = query.channel
    }
    if (query.status) {
      filter.status = query.status
    }
    if (query.from || query.to) {
      filter.createdAt = {}
      if (query.from) {
        (filter.createdAt as Record<string, Date>).$gte = new Date(query.from)
      }
      if (query.to) {
        (filter.createdAt as Record<string, Date>).$lte = new Date(query.to)
      }
    }
    const limit = Math.min(query.limit ?? 50, 200)
    const mongoFilter =
      actor.role === UserRole.CASHIER
        ? {
            $and: [
              filter,
              {
                $or: [
                  { status: { $nin: ['PAID', 'CANCELLED'] } },
                  {
                    status: { $in: ['PAID', 'CANCELLED'] },
                    updatedAt: { $gte: this.cashierHistorySince() },
                  },
                ],
              },
            ],
          }
        : filter
    return this.orderModel
      .find(mongoFilter)
      .populate({ path: 'tableId', select: 'number label publicSlug' })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(limit)
      .exec()
  }

  async listOrderHistory(
    actor: JwtPayload,
    query: {
      q?: string
      page?: number
      pageSize?: number
      channel?: OrderChannel
      tableNumber?: string
    },
  ) {
    if (actor.role === UserRole.COURIER) {
      throw new ForbiddenException('Use courier endpoints')
    }
    if (actor.role === UserRole.CUSTOMER) {
      const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50)
      const page = Math.max(Number.isFinite(query.page) ? query.page! : 0, 0)
      const and: Record<string, unknown>[] = [
        { customerId: new Types.ObjectId(actor.sub) },
        { channel: OrderChannel.ONLINE },
        { status: { $in: [ONLINE.PAID, ONLINE.CANCELLED] } },
      ]
      const rawQ = query.q?.trim().slice(0, 100) ?? ''
      if (rawQ.length > 0) {
        const escaped = rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        and.push({
          $or: [
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
            { 'items.name': { $regex: escaped, $options: 'i' } },
          ],
        })
      }
      const filter = and.length === 1 ? and[0]! : { $and: and }
      const [total, rows] = await Promise.all([
        this.orderModel.countDocuments(filter),
        this.orderModel
          .find(filter)
          .sort({ updatedAt: -1, _id: -1 })
          .skip(page * pageSize)
          .limit(pageSize)
          .exec(),
      ])
      return {
        items: rows,
        total,
        page,
        pageSize,
      }
    }
    if (
      ![UserRole.ADMIN_OWNER, UserRole.ADMIN, UserRole.CASHIER].includes(
        actor.role,
      )
    ) {
      throw new ForbiddenException()
    }

    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50)
    const pageRaw = query.page ?? 0
    const page = Math.max(
      0,
      Math.floor(typeof pageRaw === 'number' ? pageRaw : parseInt(String(pageRaw), 10)) || 0,
    )

    const and: Record<string, unknown>[] = [
      { status: { $in: ['PAID', 'CANCELLED'] } },
    ]
    if (query.channel) {
      and.push({ channel: query.channel })
    }
    if (actor.role === UserRole.CASHIER) {
      and.push({ updatedAt: { $gte: this.cashierHistorySince() } })
    }

    const rawTableNumber = query.tableNumber?.trim() ?? ''
    if (rawTableNumber.length > 0) {
      const tableNumber = Number(rawTableNumber)
      if (!Number.isInteger(tableNumber) || tableNumber < 0) {
        throw new BadRequestException('Invalid table number')
      }

      const table = await this.tablesService.findByNumber(tableNumber)
      if (!table) {
        return {
          items: [],
          total: 0,
          page,
          pageSize,
        }
      }

      and.push({ tableId: table._id })
    }

    const rawQ = query.q?.trim().slice(0, 100) ?? ''
    if (rawQ.length > 0) {
      const escaped = rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      and.push({
        $or: [
          {
            $expr: {
              $regexMatch: {
                input: { $toString: '$_id' },
                regex: escaped,
                options: 'i',
              },
            },
          },
          { 'items.name': { $regex: escaped, $options: 'i' } },
          { 'deliveryAddress.line1': { $regex: escaped, $options: 'i' } },
          { 'deliveryAddress.label': { $regex: escaped, $options: 'i' } },
          { 'deliveryAddress.city': { $regex: escaped, $options: 'i' } },
        ],
      })
    }

    const filter = and.length === 1 ? and[0]! : { $and: and }

    const [total, rows] = await Promise.all([
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find(filter)
        .populate({ path: 'tableId', select: 'number label publicSlug' })
        .sort({ updatedAt: -1, _id: -1 })
        .skip(page * pageSize)
        .limit(pageSize)
        .exec(),
    ])

    return {
      items: rows,
      total,
      page,
      pageSize,
    }
  }

  async getOrder(actor: JwtPayload, id: string): Promise<OrderDocument> {
    const order = await this.orderModel
      .findById(id)
      .populate({ path: 'tableId', select: 'number label publicSlug' })
      .exec()
    if (!order) {
      throw new NotFoundException()
    }
    if (actor.role === UserRole.CUSTOMER) {
      if (!order.customerId) {
        throw new ForbiddenException()
      }
      if (!order.customerId.equals(new Types.ObjectId(actor.sub))) {
        throw new ForbiddenException()
      }
      return order
    }
    if (actor.role === UserRole.COURIER) {
      if (!order.assignedCourierId?.equals(new Types.ObjectId(actor.sub))) {
        throw new ForbiddenException()
      }
      return order
    }
    this.ensureStaff(actor)
    this.assertCashierCanViewClosedOrder(order, actor)
    return order
  }

  async getOpenInPlaceOrderByTableSlug(tableSlug: string) {
    const table = await this.tablesService.findBySlug(tableSlug)
    if (!table || table.number === 0) {
      return null
    }
    return this.orderModel
      .findOne({
        channel: OrderChannel.IN_PLACE,
        tableId: table._id,
        status: { $nin: [IN_PLACE.PAID, IN_PLACE.CANCELLED] },
      })
      .populate({ path: 'tableId', select: 'number label publicSlug' })
      .sort({ createdAt: 1 })
      .exec()
  }

  async inPlaceTransition(
    actor: JwtPayload,
    id: string,
    action:
      | 'START'
      | 'READY'
      | 'AWAIT_PAYMENT'
      | 'MARK_PAID'
      | 'CANCEL'
      | 'COMPLETE',
  ) {
    this.ensureStaff(actor)
    const order = await this.orderModel.findById(id).exec()
    if (!order || order.channel !== OrderChannel.IN_PLACE) {
      throw new NotFoundException()
    }
    const prev = order.status
    let next = prev
    if (action === 'CANCEL') {
      if ([IN_PLACE.PAID, IN_PLACE.CANCELLED].includes(prev as never)) {
        throw new BadRequestException('Invalid transition')
      }
      next = IN_PLACE.CANCELLED
    } else if (action === 'COMPLETE') {
      this.ensureAdmin(actor)
      if ([IN_PLACE.PAID, IN_PLACE.CANCELLED].includes(prev as never)) {
        throw new BadRequestException('Invalid transition')
      }
      next = IN_PLACE.PAID
    } else if (action === 'START') {
      if (prev !== IN_PLACE.PLACED) {
        throw new BadRequestException('Invalid transition')
      }
      next = IN_PLACE.IN_PROGRESS
    } else if (action === 'READY') {
      if (prev !== IN_PLACE.IN_PROGRESS) {
        throw new BadRequestException('Invalid transition')
      }
      next = IN_PLACE.READY
    } else if (action === 'AWAIT_PAYMENT') {
      if (prev !== IN_PLACE.READY) {
        throw new BadRequestException('Invalid transition')
      }
      next = IN_PLACE.AWAITING_PAYMENT
    } else if (action === 'MARK_PAID') {
      if (
        ![IN_PLACE.READY, IN_PLACE.AWAITING_PAYMENT].includes(prev as never)
      ) {
        throw new BadRequestException('Invalid transition')
      }
      next = IN_PLACE.PAID
    }
    order.status = next
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: next,
      note: action,
    })
    await order.save()
    this.ordersStaffRealtime.notifyOrdersChanged()
    return order
  }

  async onlineTransition(
    actor: JwtPayload,
    id: string,
    action:
      | 'CONFIRM'
      | 'START_PREP'
      | 'READY_HANDOFF'
      | 'CANCEL'
      | 'MARK_PAID'
      | 'COMPLETE',
  ) {
    this.ensureStaff(actor)
    const order = await this.orderModel.findById(id).exec()
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException()
    }
    const prev = order.status
    let next = prev
    if (action === 'CANCEL') {
      if ([ONLINE.PAID, ONLINE.CANCELLED].includes(prev as never)) {
        throw new BadRequestException('Invalid transition')
      }
      next = ONLINE.CANCELLED
    } else if (action === 'COMPLETE') {
      this.ensureAdmin(actor)
      if ([ONLINE.PAID, ONLINE.CANCELLED].includes(prev as never)) {
        throw new BadRequestException('Invalid transition')
      }
      next = ONLINE.PAID
    } else if (action === 'CONFIRM') {
      if (prev !== ONLINE.PLACED) {
        throw new BadRequestException('Invalid transition')
      }
      next = ONLINE.CONFIRMED
    } else if (action === 'START_PREP') {
      if (prev !== ONLINE.CONFIRMED) {
        throw new BadRequestException('Invalid transition')
      }
      next = ONLINE.IN_PROGRESS
    } else if (action === 'READY_HANDOFF') {
      if (prev !== ONLINE.IN_PROGRESS) {
        throw new BadRequestException('Invalid transition')
      }
      next = ONLINE.READY_FOR_HANDOFF
    } else if (action === 'MARK_PAID') {
      if (prev !== ONLINE.AWAITING_CASHIER_PAYMENT) {
        throw new BadRequestException('Invalid transition')
      }
      next = ONLINE.PAID
    }
    order.status = next
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: next,
      note: action,
    })
    await order.save()
    this.ordersStaffRealtime.notifyOrdersChanged()
    return order
  }

  async assignCourier(actor: JwtPayload, id: string, courierUserId: string) {
    this.ensureStaff(actor)
    const courier = await this.usersService.findById(courierUserId)
    if (!courier || courier.role !== UserRole.COURIER || !courier.isActive) {
      throw new BadRequestException('Invalid courier')
    }
    const order = await this.orderModel.findById(id).exec()
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException()
    }
    if (order.status !== ONLINE.READY_FOR_HANDOFF) {
      throw new BadRequestException('Order not ready for handoff')
    }
    const activeCourierOrder = await this.orderModel.exists({
      assignedCourierId: courier._id,
      status: { $in: [ONLINE.ASSIGNED, ONLINE.OUT_FOR_DELIVERY] },
    })
    if (activeCourierOrder) {
      throw new BadRequestException('Courier is busy')
    }
    const prev = order.status
    order.status = ONLINE.ASSIGNED
    order.assignedCourierId = courier._id
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: ONLINE.ASSIGNED,
      metadata: { courierId: courier._id.toString() },
    })
    await order.save()
    this.ordersStaffRealtime.notifyOrdersChanged()
    return order
  }

  async courierStartDelivery(actor: JwtPayload, id: string) {
    const order = await this.orderModel.findById(id).exec()
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException()
    }
    if (!order.assignedCourierId?.equals(new Types.ObjectId(actor.sub))) {
      throw new ForbiddenException()
    }
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException()
    }
    if (order.status !== ONLINE.ASSIGNED) {
      throw new BadRequestException('Invalid transition')
    }
    const prev = order.status
    order.status = ONLINE.OUT_FOR_DELIVERY
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: ONLINE.OUT_FOR_DELIVERY,
    })
    await order.save()
    this.ordersStaffRealtime.notifyOrdersChanged()
    return order
  }

  async courierDeliver(
    actor: JwtPayload,
    id: string,
    method: CollectionMethod,
  ) {
    const order = await this.orderModel.findById(id).exec()
    if (!order || order.channel !== OrderChannel.ONLINE) {
      throw new NotFoundException()
    }
    if (!order.assignedCourierId?.equals(new Types.ObjectId(actor.sub))) {
      throw new ForbiddenException()
    }
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException()
    }
    if (order.status !== ONLINE.OUT_FOR_DELIVERY) {
      throw new BadRequestException('Invalid transition')
    }
    const prev = order.status
    order.collectionMethod = method
    order.status = ONLINE.DELIVERED
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: prev,
      to: ONLINE.DELIVERED,
      metadata: { collectionMethod: method },
    })
    order.status = ONLINE.AWAITING_CASHIER_PAYMENT
    this.pushHistory(order, {
      ...this.actorRef(actor),
      from: ONLINE.DELIVERED,
      to: ONLINE.AWAITING_CASHIER_PAYMENT,
      note:
        method === CollectionMethod.POS
          ? 'POS payment; awaiting receipt confirmation'
          : 'Cash collected by courier; awaiting cashier confirmation',
    })
    await order.save()
    this.ordersStaffRealtime.notifyOrdersChanged()
    return order
  }

  async courierCurrent(actor: JwtPayload) {
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException()
    }
    return this.orderModel
      .findOne({
        assignedCourierId: new Types.ObjectId(actor.sub),
        status: { $in: [ONLINE.ASSIGNED, ONLINE.OUT_FOR_DELIVERY] },
      })
      .sort({ updatedAt: -1 })
      .exec()
  }

  async courierHistory(
    actor: JwtPayload,
    query: { limit?: number; page?: number; pageSize?: number } = {},
  ) {
    if (actor.role !== UserRole.COURIER) {
      throw new ForbiddenException()
    }
    const pageSize = Math.min(
      Math.max(query.pageSize ?? query.limit ?? 20, 1),
      50,
    )
    const pageRaw = query.page ?? 0
    const page = Math.max(
      0,
      Math.floor(
        typeof pageRaw === 'number' ? pageRaw : parseInt(String(pageRaw), 10),
      ) || 0,
    )
    const filter = {
      assignedCourierId: new Types.ObjectId(actor.sub),
      status: { $in: [ONLINE.PAID, ONLINE.CANCELLED] },
    }
    const [total, rows] = await Promise.all([
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(page * pageSize)
        .limit(pageSize)
        .exec(),
    ])
    return {
      items: rows,
      total,
      page,
      pageSize,
    }
  }
}
