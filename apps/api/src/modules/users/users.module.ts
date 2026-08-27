import {
  BadRequestException, Body, ConflictException, Controller, Get, Inject,
  Module, Param, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditAction, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLE_KEYS, type RoleKey } from '@inventory/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '@inventory/shared';

/**
 * Account management, so an Admin can invite people from the website instead
 * of the command line. Admin and Viewer are the only roles; the server
 * validates the role against the shared list rather than trusting the client.
 */
@ApiTags('users')
@Controller('users')
class UsersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('user.read')
  @Get()
  async list(@Query('search') search?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { displayName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        roles: { where: { revokedAt: null }, include: { role: { select: { key: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Hashes and MFA material never leave the server.
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.roles.map((r) => r.role.key),
    }));
  }

  @RequirePermissions('user.create')
  @Post()
  async create(
    @Body() body: { displayName: string; email: string; roleKey: string; password: string },
    @CurrentUser() actor: Principal,
  ) {
    const email = (body.email ?? '').trim().toLowerCase();
    const displayName = (body.displayName ?? '').trim();
    const roleKey = (body.roleKey ?? '').toUpperCase() as RoleKey;
    const password = body.password ?? '';

    if (!displayName) throw new BadRequestException('Give the person a name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('That is not a valid email address.');
    }
    if (!ROLE_KEYS.includes(roleKey)) {
      throw new BadRequestException(`Role must be one of: ${ROLE_KEYS.join(', ')}`);
    }
    if (password.length < 6) {
      throw new BadRequestException('The password must be at least 6 characters.');
    }

    const existing = await this.prisma.user.findFirst({
      where: { email, deletedAt: undefined },
    });
    if (existing) {
      throw new ConflictException(`An account for ${email} already exists.`);
    }

    const role = await this.prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const created = await this.prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        // The admin knows this first password, so the owner should replace it.
        mustChangePassword: true,
        isActive: true,
        createdById: actor.userId,
        roles: { create: { roleId: role.id, assignedById: actor.userId } },
      },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'User',
      entityId: created.id,
      entityLabel: `${displayName} (${email})`,
      newValue: { email, displayName, role: roleKey },
      summary: `${actor.displayName} created a ${roleKey} account for ${displayName}`,
    });

    return {
      id: created.id,
      email: created.email,
      displayName: created.displayName,
      roles: [roleKey],
      isActive: true,
      message: `${displayName} can now sign in at the login page with ${email}.`,
    };
  }

  /** Disable or re-enable an account. Disabling ends its sessions at once. */
  @RequirePermissions('user.update')
  @Post(':id/active')
  async setActive(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @CurrentUser() actor: Principal,
  ) {
    if (id === actor.userId && body.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    const before = await this.prisma.user.findFirstOrThrow({ where: { id } });

    // An installation with no active Admin cannot be repaired from the web.
    if (!body.isActive) {
      const otherAdmins = await this.prisma.userRole.count({
        where: {
          revokedAt: null,
          role: { key: 'ADMIN' },
          user: { isActive: true, deletedAt: null, id: { not: id } },
        },
      });
      const isAdmin = await this.prisma.userRole.count({
        where: { userId: id, revokedAt: null, role: { key: 'ADMIN' } },
      });
      if (isAdmin > 0 && otherAdmins === 0) {
        throw new BadRequestException('This is the last active Admin. Create another Admin first.');
      }
    }

    const after = await this.prisma.user.update({
      where: { id },
      data: { isActive: body.isActive, updatedById: actor.userId },
    });

    if (!body.isActive) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'DEACTIVATED_BY_ADMIN' },
      });
    }

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      entityLabel: `${before.displayName} (${before.email})`,
      oldValue: { isActive: before.isActive },
      newValue: { isActive: after.isActive },
      summary: `${actor.displayName} ${body.isActive ? 're-enabled' : 'deactivated'} ${before.displayName}`,
    });

    return { id: after.id, isActive: after.isActive };
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
