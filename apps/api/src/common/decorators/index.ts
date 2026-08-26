import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Principal } from '@inventory/shared';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/**
 * Every non-public route must declare what it needs. The PermissionsGuard
 * denies by default, so forgetting this decorator locks the route rather than
 * opening it - a mistake fails closed.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Sentinel meaning "any signed-in user is allowed". Used for routes such as
 * /auth/me that every authenticated account may reach. It is an explicit
 * marker rather than an empty permission list, so that a route which simply
 * forgot its decorator still fails closed.
 */
export const ANY_AUTHENTICATED = '*authenticated*';
export const Authenticated = () =>
  SetMetadata(PERMISSIONS_KEY, [ANY_AUTHENTICATED]);

export const PERMISSION_MODE_KEY = 'permissionMode';
/** Require ANY one of the listed permissions instead of all of them. */
export const RequireAny = () => SetMetadata(PERMISSION_MODE_KEY, 'any');

export const AUDIT_KEY = 'auditMeta';
export interface AuditMeta {
  action: string;
  entityType: string;
  /** Where to find the entity id in the request/response, e.g. 'params.id'. */
  idPath?: string;
  labelPath?: string;
}
/** Opt a route into explicit audit logging with a friendly action name. */
export const Audited = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);

export const SKIP_MFA_KEY = 'skipMfa';
export const SkipMfaCheck = () => SetMetadata(SKIP_MFA_KEY, true);

export const CurrentUser = createParamDecorator(
  (field: keyof Principal | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user: Principal | undefined = req.user;
    return field && user ? user[field] : user;
  },
);
