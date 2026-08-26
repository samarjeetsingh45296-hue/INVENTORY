import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ANY_AUTHENTICATED,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PERMISSION_MODE_KEY,
} from '../decorators';
import type { Principal } from '@inventory/shared';

/**
 * Deny-by-default authorisation.
 *
 * A protected route with no @RequirePermissions is treated as a programming
 * error and refused, so a new endpoint can never accidentally ship open.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      const handler = `${context.getClass().name}.${context.getHandler().name}`;
      this.logger.error(
        `${handler} is not public and declares no permissions - refusing. ` +
          'Add @RequirePermissions(...) or @Public().',
      );
      throw new ForbiddenException('Endpoint is not authorised for use');
    }

    const req = context.switchToHttp().getRequest();
    const user: Principal | undefined = req.user;
    if (!user) throw new ForbiddenException('Not signed in');

    // Explicitly open to every authenticated account.
    if (required.includes(ANY_AUTHENTICATED)) return true;

    const mode = this.reflector.getAllAndOverride<string>(PERMISSION_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const held = new Set(user.permissions);
    const ok =
      mode === 'any'
        ? required.some((p) => held.has(p))
        : required.every((p) => held.has(p));

    if (!ok) {
      const missing = required.filter((p) => !held.has(p));
      throw new ForbiddenException(
        `Your role does not allow this action. Missing: ${missing.join(', ')}`,
      );
    }
    return true;
  }
}
