import { OrderStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuoteLineInputDto } from '@modules/quotes/dto/quotes.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeCurrency = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class OrderLineInputDto extends QuoteLineInputDto {}

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  clientId!: string;

  @ApiPropertyOptional({ example: '2026-07-28' })
  @IsOptional()
  @IsDateString({ strict: true })
  orderDate?: string;

  @ApiPropertyOptional({ example: '2026-08-15' })
  @IsOptional()
  @IsDateString({ strict: true })
  expectedDeliveryDate?: string;

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

  @ApiProperty({ type: [OrderLineInputDto], default: [] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines: OrderLineInputDto[] = [];
}

export class UpdateOrderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  orderDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  expectedDeliveryDate?: string;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional({ type: [OrderLineInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines?: OrderLineInputDto[];
}

export class OrderVersionDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class ConvertQuoteToOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  expectedDeliveryDate?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;
}

export class TransitionOrderDto extends OrderVersionDto {
  @ApiProperty({
    enum: [
      OrderStatus.IN_PROGRESS,
      OrderStatus.FULFILLED,
      OrderStatus.CANCELLED,
    ],
  })
  @IsIn([OrderStatus.IN_PROGRESS, OrderStatus.FULFILLED, OrderStatus.CANCELLED])
  status!:
    | typeof OrderStatus.IN_PROGRESS
    | typeof OrderStatus.FULFILLED
    | typeof OrderStatus.CANCELLED;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class ListOrdersQueryDto {
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

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;
}
