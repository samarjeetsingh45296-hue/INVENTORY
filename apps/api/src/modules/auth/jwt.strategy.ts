import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Principal } from '@inventory/shared';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  sid: string;
  mfa: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrisma) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  /**
   * Permissions are resolved from the database on every request rather than
   * baked into the token. Revoking a role therefore takes effect immediately,
   * instead of whenever the access token happens to expire.
   */
  async validate(payload: AccessTokenPayload): Promise<Principal> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true },
      include: {
        roles: {
          where: { revokedAt: null },
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
        scopes: true,
      },
    });

    if (!user) throw new UnauthorizedException('Account is inactive or removed');

    const now = new Date();
    const activeRoles = user.roles.filter(
      (ur) => !ur.expiresAt || ur.expiresAt > now,
    );

    const permissions = new Set<string>();
    for (const ur of activeRoles) {
      if (!ur.role.isActive || ur.role.deletedAt) continue;
      for (const rp of ur.role.permissions) permissions.add(rp.permission.key);
    }

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      employeeId: user.employeeId,
      roleKeys: activeRoles.map((ur) => ur.role.key),
      permissions: [...permissions],
      branchScope: user.scopes.map((s) => s.branchId),
      mfaVerified: payload.mfa === true,
      sessionId: payload.sid,
    };
  }
}
