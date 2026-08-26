import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '@inventory/shared';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  MfaConfirmDto,
  MfaVerifyDto,
  RefreshDto,
} from './dto';
import { Authenticated, CurrentUser, Public, SkipMfaCheck } from '../../common/decorators';
import { extractIp } from '../../common/interceptors/request-context.interceptor';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Rate limited hard: 5 attempts per minute per IP. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.email, dto.password, {
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaVerifyDto, @Req() req: any) {
    return this.auth.verifyMfa(dto.challengeToken, dto.code, {
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.refresh(dto.refreshToken, {
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @SkipMfaCheck()
  @Authenticated()
  @Post('logout')
  async logout(@CurrentUser() user: Principal, @Body() dto: Partial<RefreshDto>) {
    await this.auth.logout(user.userId, dto.refreshToken);
    return { ok: true };
  }

  /** The signed-in user's own profile, roles and effective permissions. */
  @SkipMfaCheck()
  @Authenticated()
  @Get('me')
  me(@CurrentUser() user: Principal) {
    return user;
  }

  @SkipMfaCheck()
  @Authenticated()
  @Post('password')
  async changePassword(
    @CurrentUser() user: Principal,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword);
    return { ok: true, message: 'Password updated. Other sessions have been signed out.' };
  }

  @SkipMfaCheck()
  @Authenticated()
  @Post('mfa/enrol')
  beginMfa(@CurrentUser() user: Principal) {
    return this.auth.beginMfaEnrolment(user.userId);
  }

  @SkipMfaCheck()
  @Authenticated()
  @Post('mfa/confirm')
  confirmMfa(@CurrentUser() user: Principal, @Body() dto: MfaConfirmDto) {
    return this.auth.confirmMfaEnrolment(user.userId, dto.code);
  }
}
