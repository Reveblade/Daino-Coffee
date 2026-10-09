import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Netgsm from '@netgsm/sms';
import { isValidTurkishMobileE164 } from '../../common/utils/phone.util';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    const nodeEnv = this.config.get<string>('nodeEnv') ?? 'development';
    const otpDisabled = this.config.get<boolean>('netgsm.otpDisabled');
    const username = (this.config.get<string>('netgsm.username') ?? '').trim();
    const password = (this.config.get<string>('netgsm.password') ?? '').trim();
    const msgheader = (this.config.get<string>('netgsm.msgheader') ?? '').trim();
    const appname = this.config.get<string>('netgsm.appname');

    const credsComplete = Boolean(username && password && msgheader);
    const canSend = credsComplete && !otpDisabled;

    if (!canSend) {
      const safeToPrintCode =
        otpDisabled || nodeEnv !== 'production';
      if (safeToPrintCode) {
        const reason = !credsComplete
          ? 'Netgsm not configured (set NETGSM_USERNAME, NETGSM_PASSWORD, NETGSM_MSGHEADER)'
          : 'NETGSM_OTP_DISABLED=true';
        this.logger.log(`[OTP] ${phoneE164} code=${code} — ${reason}`);
      } else {
        this.logger.warn(
          `SMS skipped in production: Netgsm not configured; OTP not logged. phone=${phoneE164}`,
        );
      }
      return;
    }

    if (!isValidTurkishMobileE164(phoneE164)) {
      throw new Error('Invalid E.164 for SMS');
    }

    /** Netgsm OTP `no`: 10-digit domestic mobile without leading 0 (e.g. 5XXXXXXXXX). */
    const no = phoneE164.slice(3);
    const msg = `DainoCoffee dogrulama kodunuz: ${code}`;

    try {
      const client = new Netgsm({
        username,
        password,
        ...(appname ? { appname } : {}),
      });
      await client.sendOtpSms({ msgheader, msg, no });
    } catch (err: unknown) {
      const detail = this.netgsmErrorDetail(err);
      this.logger.error(`Netgsm OTP error: ${detail}`);
      throw new ServiceUnavailableException('SMS provider error');
    }
  }

  private netgsmErrorDetail(err: unknown): string {
    if (err && typeof err === 'object') {
      const o = err as Record<string, unknown>;
      const code = o.code;
      const description = o.description;
      if (typeof description === 'string') {
        return [typeof code === 'string' ? code : '', description]
          .filter(Boolean)
          .join(' ');
      }
      if (typeof code === 'string') {
        return code;
      }
    }
    return err instanceof Error ? err.message : String(err);
  }
}
