import { BadRequestException } from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';
import {
  calculateDocumentLine,
  type CalculatedDocumentLine,
} from './commercial-document-calculator';

export interface CommercialLineInput {
  productId?: string;
  label?: string;
  description?: string;
  quantity: string;
  unitPrice?: string;
  unit?: string;
  discountRate?: string;
  taxRate?: string;
}

export interface ResolvedCommercialLine {
  position: number;
  label: string;
  description?: string;
  sku?: string;
  unit: string;
  productId?: string;
  calculation: CalculatedDocumentLine;
}

export async function resolveCommercialLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  currency: string,
  inputs: readonly CommercialLineInput[],
): Promise<ResolvedCommercialLine[]> {
  const productIds = [
    ...new Set(
      inputs
        .map((line) => line.productId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, tenantId, archivedAt: null },
  });
  if (products.length !== productIds.length) {
    throw new BadRequestException(
      'Une ligne référence un article absent, archivé ou d’un autre tenant',
    );
  }
  const productById = new Map(products.map((product) => [product.id, product]));

  return inputs.map((input, index) =>
    resolveLine(input, index + 1, currency, productById),
  );
}

export function commercialLineCreateData(line: ResolvedCommercialLine) {
  return {
    position: line.position,
    label: line.label,
    description: line.description,
    sku: line.sku,
    unit: line.unit,
    productId: line.productId,
    ...line.calculation,
  };
}

function resolveLine(
  input: CommercialLineInput,
  position: number,
  currency: string,
  productById: ReadonlyMap<string, Product>,
): ResolvedCommercialLine {
  const product = input.productId
    ? productById.get(input.productId)
    : undefined;
  if (product && product.currency !== currency) {
    throw new BadRequestException(
      `L’article ${product.name} est en ${product.currency}, pas en ${currency}`,
    );
  }
  if (!product && (!input.label || input.unitPrice === undefined)) {
    throw new BadRequestException(
      `La ligne libre ${position} exige un libellé et un prix unitaire`,
    );
  }

  return {
    position,
    productId: product?.id,
    label: input.label ?? product?.name ?? '',
    description: input.description ?? product?.description ?? undefined,
    sku: product?.sku ?? undefined,
    unit: input.unit ?? product?.unit ?? 'unit',
    calculation: calculateDocumentLine({
      quantity: input.quantity,
      unitPrice: input.unitPrice ?? product?.salePrice ?? 0,
      discountRate: input.discountRate ?? 0,
      taxRate: input.taxRate ?? product?.taxRate ?? 0,
    }),
  };
}
