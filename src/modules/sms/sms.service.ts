import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toNetgsmNo } from '../../common/utils/phone.util';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    const otpDisabled = this.config.get<boolean>('netgsm.otpDisabled');
    const usercode = this.config.get<string>('netgsm.usercode');
    const password = this.config.get<string>('netgsm.password');
    const msgheader = this.config.get<string>('netgsm.msgheader');

    if (otpDisabled || !usercode || !password || !msgheader) {
      this.logger.warn(
        `SMS skipped (NETGSM_OTP_DISABLED or missing creds). OTP for ${phoneE164}: ${code}`,
      );
      return;
    }

    const no = toNetgsmNo(phoneE164);
    const message = `DainoCoffee dogrulama kodunuz: ${code}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <company dil="TR">Netgsm</company>
    <usercode>${this.escapeXml(usercode)}</usercode>
    <password>${this.escapeXml(password)}</password>
    <type>1:n</type>
    <msgheader>${this.escapeXml(msgheader)}</msgheader>
  </header>
  <body>
    <msg><![CDATA[${message}]]></msg>
    <no>${no}</no>
  </body>
</mainbody>`;

    const res = await fetch('https://api.netgsm.com.tr/sms/send/xml', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      body: xml,
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`Netgsm HTTP error ${res.status}: ${text}`);
      throw new ServiceUnavailableException('SMS provider error');
    }
    if (!text.trim().startsWith('00')) {
      this.logger.error(`Netgsm business error response: ${text}`);
      throw new ServiceUnavailableException('SMS could not be sent');
    }
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
