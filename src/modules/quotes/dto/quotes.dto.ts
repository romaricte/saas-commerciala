import { QuoteStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDecimal,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeUnit = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const normalizeCurrency = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class QuoteLineInputDto {
  @ApiPropertyOptional({
    description:
      'Article actif du tenant. Sans productId, la ligne est une ligne libre.',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({
    example: 'Audit de sécurité',
    description: 'Obligatoire pour une ligne libre.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  description?: string;

  @ApiProperty({ example: '2.500' })
  @IsDecimal({ decimal_digits: '0,3', force_decimal: false })
  quantity!: string;

  @ApiPropertyOptional({
    example: '125000.00',
    description:
      'Facultatif pour un article catalogue, obligatoire pour une ligne libre.',
  })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  unitPrice?: string;

  @ApiPropertyOptional({ example: 'hour' })
  @Transform(normalizeUnit)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional({ example: '0.00', default: '0' })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  discountRate?: string;

  @ApiPropertyOptional({
    example: '18.00',
    description: 'Par défaut, taux de l’article catalogue ou 0.',
  })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  taxRate?: string;
}

export class CreateQuoteDto {
  @ApiProperty()
  @IsString()
  clientId!: string;

  @ApiPropertyOptional({ example: '2026-07-28' })
  @IsOptional()
  @IsDateString({ strict: true })
  issueDate?: string;

  @ApiPropertyOptional({ example: '2026-08-27' })
  @IsOptional()
  @IsDateString({ strict: true })
  validUntil?: string;

  @ApiProperty({ example: 'XOF', default: 'XOF' })
  @Transform(normalizeCurrency)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency = 'XOF';

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  terms?: string;

  @ApiProperty({ type: [QuoteLineInputDto], default: [] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineInputDto)
  lines: QuoteLineInputDto[] = [];
}

export class UpdateQuoteDto {
  @ApiProperty({ minimum: 1, description: 'Version courante du devis.' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ example: '2026-07-28' })
  @IsOptional()
  @IsDateString({ strict: true })
  issueDate?: string;

  @ApiPropertyOptional({ example: '2026-08-27' })
  @IsOptional()
  @IsDateString({ strict: true })
  validUntil?: string;

  @ApiPropertyOptional({ example: 'XOF' })
  @Transform(normalizeCurrency)
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  terms?: string;

  @ApiPropertyOptional({ type: [QuoteLineInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineInputDto)
  lines?: QuoteLineInputDto[];
}

export class QuoteVersionDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class TransitionQuoteDto extends QuoteVersionDto {
  @ApiProperty({
    enum: [
      QuoteStatus.ACCEPTED,
      QuoteStatus.REJECTED,
      QuoteStatus.EXPIRED,
      QuoteStatus.CANCELLED,
    ],
  })
  @IsIn([
    QuoteStatus.ACCEPTED,
    QuoteStatus.REJECTED,
    QuoteStatus.EXPIRED,
    QuoteStatus.CANCELLED,
  ])
  status!:
    | typeof QuoteStatus.ACCEPTED
    | typeof QuoteStatus.REJECTED
    | typeof QuoteStatus.EXPIRED
    | typeof QuoteStatus.CANCELLED;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class ListQuotesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
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

  @ApiPropertyOptional({ enum: QuoteStatus })
  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;
}
