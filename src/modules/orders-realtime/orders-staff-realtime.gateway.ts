import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import { Server, WebSocket } from 'ws';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { UserRole } from '../users/schemas/user.schema';

/** Staff + courier; query `?token=` = access JWT (browser WS cannot set Authorization). */
export const ORDERS_WS_PATH = '/ws/orders';

const STAFF_ROLES: UserRole[] = [
  UserRole.ADMIN_OWNER,
  UserRole.ADMIN,
  UserRole.CASHIER,
  UserRole.COURIER,
];

@WebSocketGateway({ path: ORDERS_WS_PATH })
export class OrdersStaffRealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(OrdersStaffRealtimeGateway.name);

  private readonly authed = new WeakSet<WebSocket>();

  constructor(private readonly jwt: JwtService) {}

  @WebSocketServer()
  server: Server;

  handleConnection(client: WebSocket, req: IncomingMessage) {
    try {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const token = url.searchParams.get('token');
      if (!token) {
        client.close(1008, 'token required');
        return;
      }
      const payload = this.jwt.verify<JwtPayload>(token);
      if (payload.tokenUse === 'refresh' || !payload.sub || !payload.role) {
        client.close(1008, 'invalid token');
        return;
      }
      if (!STAFF_ROLES.includes(payload.role)) {
        client.close(1008, 'forbidden role');
        return;
      }
      this.authed.add(client);
      this.logger.debug(
        `orders ws connected role=${payload.role} (n=${this.server?.clients?.size ?? 0})`,
      );
    } catch {
      client.close(1008, 'unauthorized');
    }
  }

  handleDisconnect(client: WebSocket) {
    this.authed.delete(client);
    this.logger.debug(`orders ws disconnected (n=${this.server?.clients?.size ?? 0})`);
  }

  notifyOrdersChanged(): void {
    this.broadcast({ type: 'orders' });
  }

  private broadcast(payload: { type: string }): void {
    if (!this.server?.clients) return;
    const raw = JSON.stringify(payload);
    for (const c of this.server.clients) {
      if (!this.authed.has(c)) continue;
      if (c.readyState !== WebSocket.OPEN) continue;
      try {
        c.send(raw);
      } catch {
        this.logger.warn('orders ws send failed');
      }
    }
  }
}
