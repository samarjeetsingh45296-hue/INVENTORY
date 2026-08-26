import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY, SKIP_MFA_KEY } from '../decorators';
import type { Principal } from '@inventory/shared';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T = Principal>(
    err: unknown,
    user: T | false,
    _info: unknown,
    context: ExecutionContext,
  ): T {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Not signed in');
    }

    const principal = user as unknown as Principal;
    const skipMfa = this.reflector.getAllAndOverride<boolean>(SKIP_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // A token issued before the second factor was presented can only be used
    // to complete the MFA challenge, never to reach business endpoints.
    if (!skipMfa && principal.mfaVerified === false) {
      throw new UnauthorizedException('Multi-factor authentication required');
    }
    return user as T;
  }
}
