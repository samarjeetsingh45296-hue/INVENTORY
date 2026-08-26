import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { RequestContextStore } from '../context/request-context';
import type { Principal } from '@inventory/shared';

/**
 * Opens the AsyncLocalStorage scope for the request so that anything running
 * underneath - services, the audit writer, Prisma hooks - can see who is
 * acting and from where, without it being passed down by hand.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const requestId = req.headers['x-request-id'] ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    const user: Principal | undefined = req.user;

    return new Observable((subscriber) => {
      RequestContextStore.run(
        {
          requestId,
          userId: user?.userId ?? null,
          userName: user?.displayName ?? 'Anonymous',
          userEmail: user?.email ?? null,
          roleKeys: user?.roleKeys ?? [],
          ipAddress: extractIp(req),
          userAgent: req.headers['user-agent'] ?? null,
          sessionId: user?.sessionId ?? null,
        },
        () => {
          next.handle().subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}

/**
 * Behind a load balancer `req.ip` is the proxy, so the audit trail would
 * record the same address for everybody. Prefer the forwarded chain when the
 * deployment says it is trustworthy (TRUST_PROXY).
 */
export function extractIp(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string | null {
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd;
    if (first) return first.split(',')[0]!.trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
