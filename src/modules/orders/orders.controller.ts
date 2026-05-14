import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { OrderChannel } from './schemas/order.schema';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemInputDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;
}

class CreateInPlaceOrderDto {
  @IsString()
  tableSlug: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];
}

class CreateOnlineOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @IsNumber()
  @Min(0)
  addressIndex: number;
}

class InPlaceActionDto {
  @IsIn(['START', 'READY', 'AWAIT_PAYMENT', 'MARK_PAID', 'CANCEL'])
  action: 'START' | 'READY' | 'AWAIT_PAYMENT' | 'MARK_PAID' | 'CANCEL';
}

class OnlineActionDto {
  @IsIn(['CONFIRM', 'START_PREP', 'READY_HANDOFF', 'CANCEL', 'MARK_PAID'])
  action: 'CONFIRM' | 'START_PREP' | 'READY_HANDOFF' | 'CANCEL' | 'MARK_PAID';
}

class AssignCourierDto {
  @IsString()
  courierUserId: string;
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('in-place')
  createInPlace(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInPlaceOrderDto,
  ) {
    return this.orders.createInPlace(user, dto.tableSlug, dto.items);
  }

  @Post('online')
  createOnline(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOnlineOrderDto,
  ) {
    return this.orders.createOnline(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('channel') channel?: OrderChannel,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.orders.listOrders(user, {
      channel,
      status,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.orders.getOrder(user, id);
  }

  @Post(':id/in-place/transition')
  inPlaceTransition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: InPlaceActionDto,
  ) {
    return this.orders.inPlaceTransition(user, id, dto.action);
  }

  @Post(':id/online/transition')
  onlineTransition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: OnlineActionDto,
  ) {
    return this.orders.onlineTransition(user, id, dto.action);
  }

  @Post(':id/assign-courier')
  assignCourier(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AssignCourierDto,
  ) {
    return this.orders.assignCourier(user, id, dto.courierUserId);
  }
}
