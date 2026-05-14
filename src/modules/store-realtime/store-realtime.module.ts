import { Global, Module } from '@nestjs/common';
import { StoreRealtimeGateway } from './store-realtime.gateway';

@Global()
@Module({
  providers: [StoreRealtimeGateway],
  exports: [StoreRealtimeGateway],
})
export class StoreRealtimeModule {}
