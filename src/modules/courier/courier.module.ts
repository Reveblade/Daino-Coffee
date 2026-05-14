import { Module } from '@nestjs/common';
import { CourierController } from './courier.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [CourierController],
})
export class CourierModule {}
