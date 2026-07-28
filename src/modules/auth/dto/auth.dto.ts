import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const STRONG_PASSWORD =
  /^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\d)(?=.*[^\p{L}\d\s]).+$/u;
const HUMAN_NAME = /^[\p{L}\p{M}' -]+$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @ApiProperty({ example: 'dirigeant@acme.fr' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    minLength: 12,
    example: 'UnePhrase!Solide42',
    description:
      '12 caractères minimum, avec minuscule, majuscule, chiffre et symbole.',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  @Matches(STRONG_PASSWORD, {
    message:
      'Le mot de passe doit contenir une minuscule, une majuscule, un chiffre et un symbole',
  })
  password!: string;

  @ApiProperty({ example: 'Ada' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(HUMAN_NAME, {
    message: 'Le prénom contient des caractères invalides',
  })
  firstName!: string;

  @ApiProperty({ example: 'Lovelace' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(HUMAN_NAME, { message: 'Le nom contient des caractères invalides' })
  lastName!: string;

  @ApiProperty({ example: 'Acme SARL' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @ApiPropertyOptional({ example: 'acme-sarl' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(SLUG, {
    message:
      'Le slug doit contenir uniquement des lettres minuscules, chiffres et tirets',
  })
  companySlug?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'dirigeant@acme.fr' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'dirigeant@acme.fr' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;

  @ApiProperty({ minLength: 12, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(STRONG_PASSWORD, {
    message:
      'Le mot de passe doit contenir une minuscule, une majuscule, un chiffre et un symbole',
  })
  newPassword!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class ResendVerificationDto extends ForgotPasswordDto {}

export class ChangePasswordDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 12, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(STRONG_PASSWORD, {
    message:
      'Le mot de passe doit contenir une minuscule, une majuscule, un chiffre et un symbole',
  })
  newPassword!: string;
}
