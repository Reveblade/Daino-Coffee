import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersStaffRealtimeGateway } from './orders-staff-realtime.gateway';

@Module({
  imports: [AuthModule],
  providers: [OrdersStaffRealtimeGateway],
  exports: [OrdersStaffRealtimeGateway],
})
export class OrdersStaffRealtimeModule {}
