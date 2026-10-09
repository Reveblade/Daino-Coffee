import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { User, UserSchema } from './schemas/user.schema';
import {
  OtpChallenge,
  OtpChallengeSchema,
} from './schemas/otp-challenge.schema';
import { UsersService } from './users.service';
import { AdminController, UsersController } from './users.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
      { name: OtpChallenge.name, schema: OtpChallengeSchema },
    ]),
  ],
  providers: [UsersService],
  controllers: [UsersController, AdminController],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
