import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';

/** Public path (no /v1 prefix); client: `ws(s)://host/ws/store` */
export const STORE_WS_PATH = '/ws/store';

@WebSocketGateway({ path: STORE_WS_PATH })
export class StoreRealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(StoreRealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(_client: WebSocket) {
    this.logger.debug(`client connected (n=${this.server?.clients?.size ?? 0})`);
  }

  handleDisconnect(_client: WebSocket) {
    this.logger.debug(`client disconnected (n=${this.server?.clients?.size ?? 0})`);
  }

  notifyMenuChanged(): void {
    this.broadcast({ type: 'menu' });
  }

  notifyShopChanged(): void {
    this.broadcast({ type: 'shop' });
  }

  private broadcast(payload: { type: string }): void {
    if (!this.server?.clients) return;
    const raw = JSON.stringify(payload);
    for (const client of this.server.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(raw);
        } catch {
          this.logger.warn('ws send failed');
        }
      }
    }
  }
}
