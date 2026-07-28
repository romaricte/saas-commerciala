import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const STRONG_PASSWORD =
  /^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\d)(?=.*[^\p{L}\d\s]).+$/u;
const HUMAN_NAME = /^[\p{L}\p{M}' -]+$/u;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const parseOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional()
  @Transform(parseOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class InviteUserDto {
  @ApiProperty({ example: 'collaborateur@acme.fr' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Grace' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(HUMAN_NAME)
  firstName!: string;

  @ApiProperty({ example: 'Hopper' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(HUMAN_NAME)
  lastName!: string;

  @ApiProperty({ type: [String], description: 'Au moins un rôle du tenant.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  roleIds!: string[];
}

export class AcceptInvitationDto {
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
  password!: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(HUMAN_NAME)
  firstName?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(HUMAN_NAME)
  lastName?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class AssignUserRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  roleIds!: string[];
}

export class AuditLogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;
}
