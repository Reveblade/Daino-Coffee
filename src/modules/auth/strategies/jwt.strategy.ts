import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../users/schemas/user.schema';

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
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.secret'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload?.sub || !payload?.role) {
      throw new UnauthorizedException();
    }
    if (payload.tokenUse === 'refresh') {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
