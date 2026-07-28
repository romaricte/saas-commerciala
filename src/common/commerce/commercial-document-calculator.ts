import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface DocumentCalculationInput {
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  discountRate: Prisma.Decimal.Value;
  taxRate: Prisma.Decimal.Value;
}

export interface CalculatedDocumentLine {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountRate: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

export interface CalculatedDocumentTotals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

const HUNDRED = new Prisma.Decimal(100);
const ZERO = new Prisma.Decimal(0);

export function calculateDocumentLine(
  input: DocumentCalculationInput,
): CalculatedDocumentLine {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const discountRate = new Prisma.Decimal(input.discountRate);
  const taxRate = new Prisma.Decimal(input.taxRate);

  if (quantity.lessThanOrEqualTo(0)) {
    throw new BadRequestException('La quantité doit être strictement positive');
  }
  if (unitPrice.isNegative()) {
    throw new BadRequestException('Le prix unitaire doit être positif');
  }
  assertRate(discountRate, 'Le taux de remise');
  assertRate(taxRate, 'Le taux de taxe');

  const subtotal = money(quantity.times(unitPrice));
  const discountTotal = money(subtotal.times(discountRate).dividedBy(HUNDRED));
  const taxableAmount = subtotal.minus(discountTotal);
  const taxTotal = money(taxableAmount.times(taxRate).dividedBy(HUNDRED));
  const total = money(taxableAmount.plus(taxTotal));

  return {
    quantity,
    unitPrice,
    discountRate,
    taxRate,
    subtotal,
    discountTotal,
    taxTotal,
    total,
  };
}

export function calculateDocumentTotals(
  lines: readonly CalculatedDocumentLine[],
): CalculatedDocumentTotals {
  return lines.reduce<CalculatedDocumentTotals>(
    (totals, line) => ({
      subtotal: totals.subtotal.plus(line.subtotal),
      discountTotal: totals.discountTotal.plus(line.discountTotal),
      taxTotal: totals.taxTotal.plus(line.taxTotal),
      total: totals.total.plus(line.total),
    }),
    {
      subtotal: ZERO,
      discountTotal: ZERO,
      taxTotal: ZERO,
      total: ZERO,
    },
  );
}

export function money(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

function assertRate(rate: Prisma.Decimal, label: string): void {
  if (rate.isNegative() || rate.greaterThan(HUNDRED)) {
    throw new BadRequestException(`${label} doit être compris entre 0 et 100`);
  }
}
