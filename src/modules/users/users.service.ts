import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  findByPhone(phoneE164: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phoneE164 }).exec();
  }

  async findOrCreateCustomer(phoneE164: string): Promise<UserDocument> {
    const existing = await this.findByPhone(phoneE164);
    if (existing) {
      if (existing.role !== UserRole.CUSTOMER) {
        throw new ConflictException(
          'Phone registered as staff; use staff sign-in',
        );
      }
      return existing;
    }
    return this.userModel.create({
      phoneE164,
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
      role,
      deletable: true,
      roleLocked: false,
      addresses: [],
      favoriteProductIds: [],
    });
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

  async listStaff(): Promise<UserDocument[]> {
    return this.userModel
      .find({
        role: { $in: [UserRole.ADMIN, UserRole.CASHIER, UserRole.COURIER] },
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async listActiveCouriers(): Promise<UserDocument[]> {
    return this.userModel
      .find({ role: UserRole.COURIER, isActive: true })
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
    },
  ) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException();
    }
    user.addresses.push({
      label: body.label,
      line1: body.line1,
      line2: body.line2,
      city: body.city,
      district: body.district,
      country: body.country ?? 'Türkiye',
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
