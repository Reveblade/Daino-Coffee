import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  isValidTurkishMobileE164,
  normalizeTurkishMobile,
} from '../../common/utils/phone.util';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/schemas/user.schema';
import { OtpChallenge, OtpChallengeDocument } from '../users/schemas/otp-challenge.schema';
import { SmsService } from '../sms/sms.service';
import { JwtPayload } from './strategies/jwt.strategy';
import { OtpVerifyDto } from './dto/auth.dto';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly smsService: SmsService,
    private readonly config: ConfigService,
    @InjectModel(OtpChallenge.name)
    private readonly otpModel: Model<OtpChallengeDocument>,
  ) {}

  async requestOtp(rawPhone: string): Promise<void> {
    const phoneE164 = normalizeTurkishMobile(rawPhone);
    if (!isValidTurkishMobileE164(phoneE164)) {
      return;
    }
    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    await this.otpModel.deleteMany({ phoneE164 }).exec();
    await this.otpModel.create({
      phoneE164,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 0,
    });
    await this.smsService.sendOtp(phoneE164, code);
  }

  async verifyOtp(
    dto: OtpVerifyDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const rawPhone = dto.phone;
    const code = dto.code;
    const firstName = dto.firstName?.trim();
    const lastName = dto.lastName?.trim();
    const phoneE164 = normalizeTurkishMobile(rawPhone);
    if (!isValidTurkishMobileE164(phoneE164)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const challenge = await this.otpModel.findOne({ phoneE164 }).exec();
    if (!challenge || challenge.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const match = await bcrypt.compare(code, challenge.codeHash);
    if (!match) {
      await this.otpModel
        .updateOne({ _id: challenge._id }, { $inc: { attempts: 1 } })
        .exec();
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.otpModel.deleteOne({ _id: challenge._id }).exec();

    let user = await this.usersService.findByPhone(phoneE164);
    if (!user) {
      user = await this.usersService.findOrCreateCustomer(
        phoneE164,
        firstName && lastName ? { firstName, lastName } : undefined,
      );
    } else if (user.role === UserRole.CUSTOMER) {
      if (
        (!user.firstName || !user.firstName.trim() || !user.lastName || !user.lastName.trim()) &&
        firstName &&
        lastName
      ) {
        user.firstName = firstName;
        user.lastName = lastName;
        await user.save();
      }
    } else {
      // staff must pre-exist
    }
    this.usersService.assertUserActive(user);

    return this.issueTokenPair(
      user._id.toString(),
      user.role,
      user.phoneE164,
    );
  }

  async ownerLogin(
    rawPhone: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const phoneE164 = normalizeTurkishMobile(rawPhone);
    const expected = this.config.getOrThrow<string>('owner.phoneE164');
    if (phoneE164 !== expected) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const user = await this.usersService.verifyOwnerPassword(
      phoneE164,
      password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    this.usersService.assertUserActive(user);
    return this.issueTokenPair(
      user._id.toString(),
      UserRole.ADMIN_OWNER,
      user.phoneE164,
    );
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshSecret = this.config.getOrThrow<string>('jwt.refreshSecret');
    let decoded: JwtPayload;
    try {
      decoded = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (decoded.tokenUse !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.usersService.findById(decoded.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    this.usersService.assertUserActive(user);
    return this.issueTokenPair(
      user._id.toString(),
      user.role,
      user.phoneE164,
    );
  }

  private async issueTokenPair(
    sub: string,
    role: UserRole,
    phoneE164: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = { sub, role, phoneE164 };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshSecret = this.config.getOrThrow<string>('jwt.refreshSecret');
    const refreshExpiresIn =
      this.config.get<string>('jwt.refreshExpiresIn') ?? '7d';
    const refreshToken = await this.jwtService.signAsync(
      {
        ...payload,
        tokenUse: 'refresh' as const,
        jti: crypto.randomUUID(),
      },
      {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn as JwtSignOptions['expiresIn'],
      },
    );
    return { accessToken, refreshToken };
  }
}
