import { CatalogItemType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDecimal,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeSku = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || undefined : value;
const normalizeUnit = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const normalizeCurrency = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export enum CatalogStateFilter {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  ALL = 'ALL',
}

export class CreateProductDto {
  @ApiProperty({ enum: CatalogItemType, default: CatalogItemType.PRODUCT })
  @IsOptional()
  @IsEnum(CatalogItemType)
  type?: CatalogItemType;

  @ApiProperty({ example: 'Audit de sécurité' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  description?: string;

  @ApiPropertyOptional({ example: 'SERV-AUDIT-01' })
  @Transform(normalizeSku)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @ApiPropertyOptional({ example: 'hour', default: 'unit' })
  @Transform(normalizeUnit)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit?: string;

  @ApiProperty({
    example: '125000.00',
    description: 'Montant décimal transmis sous forme de chaîne.',
  })
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  salePrice!: string;

  @ApiPropertyOptional({ example: '70000.00', nullable: true })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  costPrice?: string | null;

  @ApiPropertyOptional({ example: '18.00', default: '0' })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  taxRate?: string;

  @ApiPropertyOptional({ example: 'XOF', default: 'XOF' })
  @Transform(normalizeCurrency)
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ListProductsQueryDto {
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

  @ApiPropertyOptional({ enum: CatalogItemType })
  @IsOptional()
  @IsEnum(CatalogItemType)
  type?: CatalogItemType;

  @ApiPropertyOptional({
    enum: CatalogStateFilter,
    default: CatalogStateFilter.ACTIVE,
  })
  @IsEnum(CatalogStateFilter)
  state: CatalogStateFilter = CatalogStateFilter.ACTIVE;
}
