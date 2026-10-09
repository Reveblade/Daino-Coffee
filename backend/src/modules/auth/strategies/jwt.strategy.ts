import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  phoneE164: string;
  /** Present only on refresh JWTs; must never be accepted as an API access token. */
  tokenUse?: 'refresh';
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload?.sub || !payload?.role) {
      throw new UnauthorizedException();
    }
    if (payload.tokenUse === 'refresh') {
      throw new UnauthorizedException();
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.isActive === false) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
