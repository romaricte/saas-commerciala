import { BadRequestException, ConflictException } from '@nestjs/common';
import { CatalogItemType, Prisma, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  const actor: AuthenticatedUser = {
    id: 'user-1',
    email: 'commercial@acme.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: UserRole.USER,
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    emailVerified: true,
    roles: [],
    permissions: ['products.read', 'products.create'],
  };
  const product = {
    id: 'product-1',
    type: CatalogItemType.SERVICE,
    name: 'Audit',
    description: null,
    sku: 'AUDIT-01',
    unit: 'hour',
    salePrice: new Prisma.Decimal('100.00'),
    costPrice: new Prisma.Decimal('50.00'),
    taxRate: new Prisma.Decimal('18.00'),
    currency: 'XOF',
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const tx = {
    product: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    product: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  let service: ProductsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (client: typeof tx) => unknown) => operation(tx),
    );
    service = new ProductsService(prisma as never, audit as never);
  });

  it('refuse un prix de vente négatif avant toute écriture', async () => {
    await expect(
      service.create(actor, {
        type: CatalogItemType.SERVICE,
        name: 'Audit',
        unit: 'hour',
        salePrice: '-1.00',
        taxRate: '0',
        currency: 'XOF',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('archive logiquement un article et journalise le changement', async () => {
    prisma.product.findFirst.mockResolvedValue(product);
    tx.product.update.mockResolvedValue({
      ...product,
      archivedAt: new Date(),
    });

    const result = await service.archive(actor, product.id);

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { archivedAt: expect.any(Date) as Date },
      }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'product.archived' }),
    );
    expect(result.isArchived).toBe(true);
  });

  it('refuse de ré-archiver un article déjà archivé', async () => {
    prisma.product.findFirst.mockResolvedValue({
      ...product,
      archivedAt: new Date(),
    });

    await expect(service.archive(actor, product.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
