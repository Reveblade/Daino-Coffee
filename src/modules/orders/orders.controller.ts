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

class OrderItemOptionInputDto {
  @IsString()
  groupId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedChoiceIds?: string[];
}

class OrderItemInputDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemOptionInputDto)
  options?: OrderItemOptionInputDto[];
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
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Herkese açık: QR masa siparişi kullanıcı hesabına yazılmaz. */
  @Post('in-place')
  createInPlace(@Body() dto: CreateInPlaceOrderDto) {
    return this.orders.createInPlace(dto.tableSlug, dto.items);
  }

  @Post('online')
  @UseGuards(JwtAuthGuard)
  createOnline(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOnlineOrderDto,
  ) {
    return this.orders.createOnline(user, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
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

  /** Tamamlanmış / iptal siparişler: arama + sayfalama (`:id` rotasından önce tanımlı). */
  @Get('history')
  @UseGuards(JwtAuthGuard)
  listHistory(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('channel') channel?: OrderChannel,
  ) {
    return this.orders.listOrderHistory(user, {
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      channel,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.orders.getOrder(user, id);
  }

  @Post(':id/in-place/transition')
  @UseGuards(JwtAuthGuard)
  inPlaceTransition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: InPlaceActionDto,
  ) {
    return this.orders.inPlaceTransition(user, id, dto.action);
  }

  @Post(':id/online/transition')
  @UseGuards(JwtAuthGuard)
  onlineTransition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: OnlineActionDto,
  ) {
    return this.orders.onlineTransition(user, id, dto.action);
  }

  @Post(':id/assign-courier')
  @UseGuards(JwtAuthGuard)
  assignCourier(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AssignCourierDto,
  ) {
    return this.orders.assignCourier(user, id, dto.courierUserId);
  }
}
