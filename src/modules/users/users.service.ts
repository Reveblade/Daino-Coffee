import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { User, UserAddress, UserDocument, UserRole } from './schemas/user.schema';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

export interface StaffAdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const DELIVERY_DISTRICT = 'akhisar';
const DELIVERY_AREA_MESSAGE =
  'Web siparişi için teslimat adresi Akhisar içinde olmalıdır.';
const BUSY_COURIER_STATUSES = ['ASSIGNED', 'OUT_FOR_DELIVERY'] as const;

function normalizeDeliveryText(value?: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  findByPhone(phoneE164: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phoneE164 }).exec();
  }

  isCustomerProfileComplete(user: UserDocument): boolean {
    if (user.role !== UserRole.CUSTOMER) {
      return true;
    }
    const fn = (user.firstName?.trim() ?? '').length;
    const ln = (user.lastName?.trim() ?? '').length;
    return fn >= 2 && ln >= 2;
  }

  isCustomerAddressComplete(user: UserDocument): boolean {
    if (user.role !== UserRole.CUSTOMER) {
      return true;
    }
    return user.addresses.some(
      (address) =>
        address.label?.trim().length >= 2 &&
        address.line1?.trim().length >= 5 &&
        address.city?.trim().length >= 2 &&
        this.isDeliveryAddressSupported(address),
    );
  }

  isDeliveryAddressSupported(
    address: Pick<UserAddress, 'city' | 'district' | 'formattedAddress'>,
  ): boolean {
    return [address.district, address.city, address.formattedAddress].some(
      (part) => normalizeDeliveryText(part).includes(DELIVERY_DISTRICT),
    );
  }

  isCustomerAccountComplete(user: UserDocument): boolean {
    return (
      this.isCustomerProfileComplete(user) &&
      this.isCustomerAddressComplete(user)
    );
  }

  assertCustomerProfileComplete(user: UserDocument): void {
    if (!this.isCustomerProfileComplete(user)) {
      throw new ForbiddenException(
        'Bu işlem için önce Profilim bölümünden isim ve soyisminizi girin (en az 2 karakter).',
      );
    }
  }

  assertCustomerAccountComplete(user: UserDocument): void {
    this.assertCustomerProfileComplete(user);
    if (!this.isCustomerAddressComplete(user)) {
      throw new ForbiddenException(
        'Bu işlem için önce hesabınıza Akhisar içinde en az bir teslimat adresi ekleyin.',
      );
    }
  }

  async findOrCreateCustomer(
    phoneE164: string,
    profile?: { firstName?: string; lastName?: string },
  ): Promise<UserDocument> {
    const existing = await this.findByPhone(phoneE164);
    if (existing) {
      if (existing.role !== UserRole.CUSTOMER) {
        throw new ConflictException(
          'Phone registered as staff; use staff sign-in',
        );
      }
      return existing;
    }
    const fn = profile?.firstName?.trim();
    const ln = profile?.lastName?.trim();
    return this.userModel.create({
      phoneE164,
      firstName: fn?.length ? fn : undefined,
      lastName: ln?.length ? ln : undefined,
      role: UserRole.CUSTOMER,
      deletable: true,
      roleLocked: false,
      addresses: [],
      favoriteProductIds: [],
    });
  }

  async createStaffUser(
    phoneE164: string,
    role: UserRole.ADMIN | UserRole.CASHIER | UserRole.COURIER,
    profile?: { firstName?: string; lastName?: string },
  ): Promise<UserDocument> {
    const existing = await this.findByPhone(phoneE164);
    if (existing) {
      if (existing.role === UserRole.CUSTOMER) {
        throw new ConflictException(
          'Phone already registered as customer; cannot assign staff role',
        );
      }
      if (existing.role === role) {
        return existing;
      }
      throw new ConflictException(
        'Phone already used by another staff account',
      );
    }
    return this.userModel.create({
      phoneE164,
      firstName: profile?.firstName?.trim() || undefined,
      lastName: profile?.lastName?.trim() || undefined,
      role,
      deletable: true,
      roleLocked: false,
      addresses: [],
      favoriteProductIds: [],
    });
  }

  async updateStaffProfile(
    userId: string,
    body: { firstName?: string; lastName?: string },
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException();
    }
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.CASHIER &&
      user.role !== UserRole.COURIER
    ) {
      throw new ConflictException('Not a staff user');
    }
    if (body.firstName !== undefined) {
      const t = body.firstName.trim();
      user.firstName = t.length ? t : undefined;
    }
    if (body.lastName !== undefined) {
      const t = body.lastName.trim();
      user.lastName = t.length ? t : undefined;
    }
    await user.save();
    return user;
  }

  async updateProfile(
    userId: string,
    body: { firstName?: string; lastName?: string },
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException();
    }
    if (body.firstName !== undefined) {
      const t = body.firstName.trim();
      user.firstName = t.length ? t : undefined;
    }
    if (body.lastName !== undefined) {
      const t = body.lastName.trim();
      user.lastName = t.length ? t : undefined;
    }
    await user.save();
    return user;
  }

  async ensureOwnerUser(
    phoneE164: string,
    plainPassword: string,
  ): Promise<UserDocument> {
    const user = await this.findByPhone(phoneE164);
    const passwordHash = await bcrypt.hash(plainPassword, 12);
    if (!user) {
      return this.userModel.create({
        phoneE164,
        role: UserRole.ADMIN_OWNER,
        deletable: false,
        roleLocked: true,
        passwordHash,
        addresses: [],
        favoriteProductIds: [],
      });
    }
    if (user.role !== UserRole.ADMIN_OWNER) {
      user.role = UserRole.ADMIN_OWNER;
      user.deletable = false;
      user.roleLocked = true;
    }
    user.passwordHash = passwordHash;
    await user.save();
    return user;
  }

  async verifyOwnerPassword(
    phoneE164: string,
    plainPassword: string,
  ): Promise<UserDocument | null> {
    const user = await this.userModel
      .findOne({ phoneE164 })
      .select('+passwordHash')
      .exec();
    if (!user?.passwordHash) {
      return null;
    }
    const ok = await bcrypt.compare(plainPassword, user.passwordHash);
    return ok ? user : null;
  }

  async listStaff(opts?: {
    page?: number;
    pageSize?: number;
  }): Promise<UserDocument[] | StaffAdminPage<UserDocument>> {
    const filter = {
      role: { $in: [UserRole.ADMIN, UserRole.CASHIER, UserRole.COURIER] },
    };
    const sort = { createdAt: -1 as const };
    const usePaging =
      opts != null &&
      Number.isFinite(opts.page) &&
      Number.isFinite(opts.pageSize) &&
      opts.page! >= 0 &&
      opts.pageSize! >= 1;
    if (!usePaging) {
      return this.userModel.find(filter).sort(sort).exec();
    }
    const page = Math.floor(Math.max(0, opts!.page!));
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts!.pageSize!)));
    const [total, items] = await Promise.all([
      this.userModel.countDocuments(filter).exec(),
      this.userModel
        .find(filter)
        .sort(sort)
        .skip(page * pageSize)
        .limit(pageSize)
        .exec(),
    ]);
    return { items, total, page, pageSize };
  }

  async listActiveCouriers(): Promise<UserDocument[]> {
    const busyCourierIds = await this.orderModel.distinct('assignedCourierId', {
      assignedCourierId: { $ne: null },
      status: { $in: BUSY_COURIER_STATUSES },
    });

    return this.userModel
      .find({
        role: UserRole.COURIER,
        isActive: true,
        _id: { $nin: busyCourierIds },
      })
      .sort({ phoneE164: 1 })
      .exec();
  }

  async deleteStaffIfAllowed(id: string, actor: JwtPayload): Promise<void> {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (
      !user.deletable ||
      user.roleLocked ||
      user.role === UserRole.ADMIN_OWNER
    ) {
      throw new ConflictException('User cannot be removed');
    }
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.CASHIER &&
      user.role !== UserRole.COURIER
    ) {
      throw new ConflictException('Not a staff user');
    }
    if (user.role === UserRole.ADMIN && actor.role !== UserRole.ADMIN_OWNER) {
      throw new ConflictException('Only owner can remove admin accounts');
    }
    await this.userModel.deleteOne({ _id: user._id }).exec();
  }

  async addAddress(
    userId: string,
    body: {
      label: string;
      line1: string;
      line2?: string;
      city: string;
      district?: string;
      country?: string;
      formattedAddress?: string;
      placeId?: string;
      lat?: number;
      lng?: number;
    },
  ) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException();
    }
    this.assertCustomerProfileComplete(user);
    const label = body.label.trim();
    const line1 = body.line1.trim();
    const line2 = body.line2?.trim();
    const district = body.district?.trim();
    const city = body.city.trim();
    const country = body.country?.trim();
    const formattedAddress = body.formattedAddress?.trim();
    const placeId = body.placeId?.trim();

    if (label.length < 2 || line1.length < 5 || city.length < 2) {
      throw new BadRequestException(
        'Adres adı, adres satırı ve şehir alanlarını eksiksiz girin.',
      );
    }
    if (!this.isDeliveryAddressSupported({ city, district, formattedAddress })) {
      throw new BadRequestException(DELIVERY_AREA_MESSAGE);
    }
    if (
      (body.lat !== undefined && body.lng === undefined) ||
      (body.lng !== undefined && body.lat === undefined)
    ) {
      throw new BadRequestException('Konum için enlem ve boylam birlikte gönderilmeli.');
    }

    user.addresses.push({
      label,
      line1,
      line2: line2 || undefined,
      city,
      district: district || undefined,
      country: country || 'Türkiye',
      formattedAddress: formattedAddress || undefined,
      placeId: placeId || undefined,
      lat: body.lat,
      lng: body.lng,
    });
    await user.save();
    return user;
  }

  async removeAddress(userId: string, index: number) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException();
    }
    if (index < 0 || index >= user.addresses.length) {
      throw new NotFoundException('Address not found');
    }
    user.addresses.splice(index, 1);
    await user.save();
    return user;
  }

  async toggleFavorite(userId: string, productId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException();
    }
    this.assertCustomerProfileComplete(user);
    const pid = new Types.ObjectId(productId);
    const idx = user.favoriteProductIds.findIndex((id) => id.equals(pid));
    if (idx >= 0) {
      user.favoriteProductIds.splice(idx, 1);
    } else {
      user.favoriteProductIds.push(pid);
    }
    await user.save();
    return user;
  }
}
