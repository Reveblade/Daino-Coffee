import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller()
export class HealthController {
  @Get('healthz')
  healthz(): { status: string } {
    return { status: 'ok' };
  }
}
