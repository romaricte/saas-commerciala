import { ConflictException } from '@nestjs/common';
import {
  InvoiceStatus,
  OrderStatus,
  Prisma,
  QuoteStatus,
  UserRole,
} from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
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
    permissions: ['orders.confirm'],
  };
  const order = {
    id: 'order-1',
    number: 'CMD-2026-000001',
    status: OrderStatus.DRAFT,
    version: 2,
    orderDate: new Date(),
    expectedDeliveryDate: null,
    currency: 'XOF',
    notes: null,
    subtotal: new Prisma.Decimal(0),
    discountTotal: new Prisma.Decimal(0),
    taxTotal: new Prisma.Decimal(0),
    total: new Prisma.Decimal(0),
    tenantId: 'tenant-1',
    clientId: 'client-1',
    quoteId: null,
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    client: {
      id: 'client-1',
      name: 'Client',
      email: null,
      phone: null,
      address: null,
    },
    quote: null,
    invoice: null,
    createdBy: null,
    lines: [],
    history: [],
  };
  const tx = {
    salesOrder: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    quote: {
      findFirst: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn() };
  const audit = { write: jest.fn() };
  let service: OrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (client: typeof tx) => unknown) => operation(tx),
    );
    tx.salesOrder.findFirst.mockResolvedValue(order);
    service = new OrdersService(prisma as never, audit as never);
  });

  it('détecte une version de commande obsolète', async () => {
    await expect(
      service.confirm(actor, order.id, { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse de confirmer une commande vide', async () => {
    await expect(
      service.confirm(actor, order.id, { version: order.version }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.salesOrder.update).not.toHaveBeenCalled();
  });

  it('refuse de convertir un devis qui n’est pas accepté', async () => {
    tx.quote.findFirst.mockResolvedValue({
      id: 'quote-1',
      status: QuoteStatus.SENT,
      order: null,
      lines: [],
    });

    await expect(
      service.createFromQuote(actor, 'quote-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse d’annuler une commande possédant une facture active', async () => {
    tx.salesOrder.findFirst.mockResolvedValue({
      ...order,
      status: OrderStatus.CONFIRMED,
      invoice: {
        id: 'invoice-1',
        number: 'FAC-2026-000001',
        status: InvoiceStatus.ISSUED,
      },
    });

    await expect(
      service.transition(actor, order.id, {
        version: order.version,
        status: OrderStatus.CANCELLED,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
