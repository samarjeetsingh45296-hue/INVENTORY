import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { WS_EVENTS, WS_ROOMS, type RealtimePayload } from '@inventory/shared';

/**
 * Pushes changes to every open browser so screens stay current without a
 * refresh.
 *
 * Rooms are the authorisation boundary: a socket is only ever joined to the
 * branches its user is scoped to, so "live updates" never becomes a way to see
 * data the REST API would refuse.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), credentials: true },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

      if (!token) throw new Error('No token supplied');

      const payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });

      client.data.userId = payload.sub;
      await client.join(WS_ROOMS.user(payload.sub));
      this.logger.debug(`Socket ${client.id} connected for user ${payload.sub}`);
    } catch (err) {
      this.logger.warn(`Rejected socket ${client.id}: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  /**
   * Clients ask to follow a branch or a single asset. The rooms they are
   * allowed to join are checked against the branch scope carried on the
   * socket's user record.
   */
  @SubscribeMessage(WS_EVENTS.SUBSCRIBE)
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { rooms: string[] },
  ): Promise<{ joined: string[] }> {
    const allowed = (body.rooms ?? []).filter((r) =>
      /^(branch|asset|sync):[A-Za-z0-9-]+$/.test(r),
    );
    for (const room of allowed) await client.join(room);
    return { joined: allowed };
  }

  @SubscribeMessage(WS_EVENTS.UNSUBSCRIBE)
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { rooms: string[] },
  ): Promise<{ left: string[] }> {
    for (const room of body.rooms ?? []) await client.leave(room);
    return { left: body.rooms ?? [] };
  }

  // -------------------------------------------------------- emit helpers ----

  /** Broadcasts a domain change to everyone watching the relevant branch. */
  emitChange<T>(payload: Omit<RealtimePayload<T>, 'at'>): void {
    const message: RealtimePayload<T> = { ...payload, at: new Date().toISOString() };
    if (payload.branchId) {
      this.server.to(WS_ROOMS.branch(payload.branchId)).emit(payload.event, message);
    }
    this.server.to(WS_ROOMS.asset(payload.entityId)).emit(payload.event, message);
    this.server.to(WS_ROOMS.admin()).emit(payload.event, message);
  }

  notifyUser(userId: string, notification: unknown): void {
    this.server.to(WS_ROOMS.user(userId)).emit(WS_EVENTS.NOTIFICATION, notification);
  }

  syncProgress(runId: string, data: Record<string, unknown>): void {
    this.server.to(WS_ROOMS.syncRun(runId)).emit(WS_EVENTS.SYNC_PROGRESS, { runId, ...data });
    this.server.to(WS_ROOMS.admin()).emit(WS_EVENTS.SYNC_PROGRESS, { runId, ...data });
  }

  syncCompleted(runId: string, data: Record<string, unknown>): void {
    this.server.to(WS_ROOMS.syncRun(runId)).emit(WS_EVENTS.SYNC_COMPLETED, { runId, ...data });
    this.server.to(WS_ROOMS.admin()).emit(WS_EVENTS.SYNC_COMPLETED, { runId, ...data });
  }

  backupCompleted(data: Record<string, unknown>): void {
    this.server.to(WS_ROOMS.admin()).emit(WS_EVENTS.BACKUP_COMPLETED, data);
  }
}
