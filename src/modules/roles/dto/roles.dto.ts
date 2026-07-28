import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeSlug = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateRoleDto {
  @ApiProperty({ example: 'Commercial senior' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'commercial-senior' })
  @Transform(normalizeSlug)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(SLUG)
  slug?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ minimum: 1, maximum: 90, example: 30 })
  @IsInt()
  @Min(1)
  @Max(90)
  rank!: number;

  @ApiProperty({ type: [String], example: ['users.read'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  rank?: number;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}
