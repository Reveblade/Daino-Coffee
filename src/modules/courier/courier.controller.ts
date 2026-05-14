import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CollectionMethod } from '../orders/schemas/order.schema';
import { IsEnum } from 'class-validator';

class DeliverDto {
  @IsEnum(CollectionMethod)
  collectionMethod: CollectionMethod;
}

@Controller('courier')
@UseGuards(JwtAuthGuard)
export class CourierController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders/current')
  current(@CurrentUser() user: JwtPayload) {
    return this.orders.courierCurrent(user);
  }

  @Get('orders/history')
  history(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    return this.orders.courierHistory(
      user,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post('orders/:id/start-delivery')
  start(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.orders.courierStartDelivery(user, id);
  }

  @Post('orders/:id/deliver')
  deliver(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DeliverDto,
  ) {
    return this.orders.courierDeliver(user, id, dto.collectionMethod);
  }
}
