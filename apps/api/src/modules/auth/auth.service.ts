import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { randomUUID } from 'node:crypto';
import { AuditAction } from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  encryptSecret,
  decryptSecret,
  sha256,
  randomToken,
} from '../../common/utils/crypto.util';

export interface LoginContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export type LoginResult =
  | ({ status: 'AUTHENTICATED' } & TokenPair & { mustChangePassword: boolean })
  | { status: 'MFA_REQUIRED'; challengeToken: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- login ----

  async login(
    email: string,
    password: string,
    ctx: LoginContext,
  ): Promise<LoginResult> {
    const normalised = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: normalised },
      include: { roles: { include: { role: true } } },
    });

    // Same failure shape and similar timing whether or not the account exists,
    // so this endpoint cannot be used to enumerate valid email addresses.
    if (!user) {
      await argon2.hash(password).catch(() => undefined);
      await this.recordLogin(null, normalised, false, 'NO_SUCH_USER', ctx);
      throw new UnauthorizedException('Incorrect email or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLogin(user.id, normalised, false, 'LOCKED', ctx);
      throw new ForbiddenException(
        `Account is locked until ${user.lockedUntil.toISOString()} after too many failed attempts.`,
      );
    }

    if (!user.isActive || user.deletedAt) {
      await this.recordLogin(user.id, normalised, false, 'INACTIVE', ctx);
      throw new ForbiddenException('This account has been deactivated');
    }

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      await this.registerFailedAttempt(user.id, user.failedLoginCount);
      await this.recordLogin(user.id, normalised, false, 'BAD_PASSWORD', ctx);
      throw new UnauthorizedException('Incorrect email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    const roleKeys = user.roles.map((r) => r.role.key);
    const mfaRequiredRoles = (
      this.config.get<string>('env.MFA_REQUIRED_ROLES') ?? ''
    ).split(',').map((s) => s.trim());
    const mfaMandatory = roleKeys.some((k) => mfaRequiredRoles.includes(k));

    if (user.mfaEnabled) {
      // Short-lived token that unlocks nothing except the MFA verify endpoint.
      const challengeToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, sid: randomUUID(), mfa: false },
        {
          secret: this.config.get<string>('env.JWT_ACCESS_SECRET'),
          expiresIn: '5m',
        },
      );
      return { status: 'MFA_REQUIRED', challengeToken };
    }

    if (mfaMandatory) {
      throw new ForbiddenException(
        'Your role requires multi-factor authentication. Ask a Super Admin to enrol your device.',
      );
    }

    const tokens = await this.issueTokens(user.id, user.email, true, ctx);
    await this.afterSuccessfulLogin(user.id, normalised, ctx);
    return {
      status: 'AUTHENTICATED',
      ...tokens,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async verifyMfa(
    challengeToken: string,
    code: string,
    ctx: LoginContext,
  ): Promise<LoginResult> {
    let payload: { sub: string; email: string };
    try {
      payload = await this.jwt.verifyAsync(challengeToken, {
        secret: this.config.get<string>('env.JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('The sign-in challenge has expired. Start again.');
    }

    const user = await this.prisma.user.findFirst({ where: { id: payload.sub } });
    if (!user?.mfaSecretEnc) throw new UnauthorizedException('MFA is not set up');

    const secret = decryptSecret(user.mfaSecretEnc);
    const valid = authenticator.check(code.replace(/\s/g, ''), secret);

    if (!valid) {
      const usedRecovery = await this.consumeRecoveryCode(user.id, code);
      if (!usedRecovery) {
        await this.registerFailedAttempt(user.id, user.failedLoginCount);
        await this.recordLogin(user.id, user.email, false, 'BAD_MFA_CODE', ctx);
        throw new UnauthorizedException('That code is not valid');
      }
    }

    const tokens = await this.issueTokens(user.id, user.email, true, ctx);
    await this.afterSuccessfulLogin(user.id, user.email, ctx, true);
    return {
      status: 'AUTHENTICATED',
      ...tokens,
      mustChangePassword: user.mustChangePassword,
    };
  }

  // ------------------------------------------------------------ tokens ----

  /**
   * Refresh tokens rotate on every use and are tracked as a family.
   * Presenting a token that has already been rotated means it leaked, so the
   * entire family is revoked and the user must sign in again.
   */
  async refresh(rawToken: string, ctx: LoginContext): Promise<TokenPair> {
    const tokenHash = sha256(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) throw new UnauthorizedException('Session not recognised');

    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'TOKEN_REUSE_DETECTED' },
      });
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        entityId: existing.userId,
        summary: 'Refresh token reuse detected; all sessions in the family revoked',
      });
      throw new UnauthorizedException(
        'This session was already replaced. For your security every session has been ended.',
      );
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    if (!existing.user.isActive || existing.user.deletedAt) {
      throw new ForbiddenException('This account has been deactivated');
    }

    const next = await this.issueTokens(
      existing.userId,
      existing.user.email,
      true,
      ctx,
      existing.familyId,
    );

    await this.prisma.refreshToken.update({
      where: { tokenHash },
      data: {
        revokedAt: new Date(),
        revokedReason: 'ROTATED',
        replacedByHash: sha256(next.refreshToken),
      },
    });

    return next;
  }

  async logout(userId: string, rawToken?: string): Promise<void> {
    if (rawToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(rawToken), revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
    }
    await this.audit.record({
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
      summary: 'Signed out',
    });
  }

  /** Ends every session for a user - used when a role is revoked or on lockout. */
  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    mfaVerified: boolean,
    ctx: LoginContext,
    familyId = randomUUID(),
  ): Promise<TokenPair> {
    const sid = randomUUID();
    const accessTtl = this.config.get<string>('env.JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.config.get<string>('env.JWT_REFRESH_TTL') ?? '7d';

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, sid, mfa: mfaVerified },
      {
        secret: this.config.get<string>('env.JWT_ACCESS_SECRET'),
        expiresIn: accessTtl,
      },
    );

    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        familyId,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
        expiresAt: new Date(Date.now() + parseDuration(refreshTtl)),
      },
    });

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  // --------------------------------------------------------- passwords ----

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!ok) throw new UnauthorizedException('Your current password is not correct');

    this.assertPasswordStrength(newPassword);
    if (await argon2.verify(user.passwordHash, newPassword).catch(() => false)) {
      throw new BadRequestException('Choose a password you have not used before');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    // Changing a password ends every other session.
    await this.revokeAllSessions(userId, 'PASSWORD_CHANGED');
    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: userId,
      summary: 'Password changed by the account owner',
    });
  }

  hashPassword(plain: string): Promise<string> {
    // argon2id with parameters sized for a server, not a phone.
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  assertPasswordStrength(password: string): void {
    const min = Number(this.config.get('env.PASSWORD_MIN_LENGTH') ?? 12);
    const problems: string[] = [];
    if (password.length < min) problems.push(`be at least ${min} characters`);
    if (!/[a-z]/.test(password)) problems.push('include a lowercase letter');
    if (!/[A-Z]/.test(password)) problems.push('include an uppercase letter');
    if (!/[0-9]/.test(password)) problems.push('include a digit');
    if (!/[^A-Za-z0-9]/.test(password)) problems.push('include a symbol');
    if (problems.length) {
      throw new BadRequestException(`Password must ${problems.join(', ')}.`);
    }
  }

  // --------------------------------------------------------------- mfa ----

  /** Returns the otpauth:// URI the authenticator app scans. */
  async beginMfaEnrolment(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    const issuer = this.config.get<string>('env.MFA_ISSUER') ?? 'Inventory Suite';

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: encryptSecret(secret) },
    });

    return {
      secret,
      otpauthUrl: authenticator.keyuri(user.email, issuer, secret),
    };
  }

  /** Confirms the device works before MFA is actually switched on. */
  async confirmMfaEnrolment(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId } });
    if (!user.mfaSecretEnc) throw new BadRequestException('Start MFA enrolment first');

    if (!authenticator.check(code.replace(/\s/g, ''), decryptSecret(user.mfaSecretEnc))) {
      throw new BadRequestException('That code is not valid. Check the time on your device.');
    }

    const plainCodes = Array.from({ length: 10 }, () => randomToken(6));
    const hashed = await Promise.all(plainCodes.map((c) => argon2.hash(c)));

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaRecoveryCodes: hashed },
    });

    await this.audit.record({
      action: AuditAction.MFA_ENABLED,
      entityType: 'User',
      entityId: userId,
      summary: 'Multi-factor authentication enabled',
    });

    // Shown exactly once.
    return { recoveryCodes: plainCodes };
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId } });
    const hashes = (user.mfaRecoveryCodes as string[]) ?? [];

    for (let i = 0; i < hashes.length; i++) {
      const h = hashes[i];
      if (h && (await argon2.verify(h, code).catch(() => false))) {
        const remaining = hashes.filter((_, idx) => idx !== i);
        await this.prisma.user.update({
          where: { id: userId },
          data: { mfaRecoveryCodes: remaining },
        });
        await this.audit.record({
          action: AuditAction.LOGIN,
          entityType: 'User',
          entityId: userId,
          summary: `Signed in with a recovery code (${remaining.length} left)`,
        });
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ helpers ----

  private async registerFailedAttempt(userId: string, current: number): Promise<void> {
    const max = Number(this.config.get('env.LOGIN_MAX_ATTEMPTS') ?? 5);
    const lockMinutes = Number(this.config.get('env.LOGIN_LOCKOUT_MINUTES') ?? 15);
    const next = current + 1;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil:
          next >= max ? new Date(Date.now() + lockMinutes * 60_000) : null,
      },
    });

    if (next >= max) {
      this.logger.warn(`User ${userId} locked after ${next} failed attempts`);
      await this.revokeAllSessions(userId, 'LOCKED_OUT');
    }
  }

  private async afterSuccessfulLogin(
    userId: string,
    email: string,
    ctx: LoginContext,
    mfaUsed = false,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), lastLoginIp: ctx.ipAddress },
    });
    await this.recordLogin(userId, email, true, null, ctx, mfaUsed);
    await this.audit.record({
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: userId,
      summary: mfaUsed ? 'Signed in with MFA' : 'Signed in',
    });
  }

  private async recordLogin(
    userId: string | null,
    emailTried: string,
    success: boolean,
    failureReason: string | null,
    ctx: LoginContext,
    mfaUsed = false,
  ): Promise<void> {
    await this.prisma.loginHistory.create({
      data: {
        userId,
        emailTried,
        success,
        failureReason,
        mfaUsed,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }
}

/** Converts "15m" / "7d" / "30s" into milliseconds. */
export function parseDuration(input: string): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) throw new Error(`Cannot parse duration: ${input}`);
  const value = Number(m[1]);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return value * factor;
}
