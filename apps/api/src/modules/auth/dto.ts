import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}

export class MfaVerifyDto {
  @IsString() @IsNotEmpty()
  challengeToken!: string;

  @IsString() @IsNotEmpty({ message: 'Enter the 6-digit code' })
  code!: string;
}

export class RefreshDto {
  @IsString() @IsNotEmpty()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty()
  currentPassword!: string;

  @IsString() @MinLength(12, { message: 'Use at least 12 characters' })
  newPassword!: string;
}

export class MfaConfirmDto {
  @IsString() @IsNotEmpty()
  code!: string;
}
