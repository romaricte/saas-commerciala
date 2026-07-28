import { ConflictException } from '@nestjs/common';
import { Prisma, QuoteStatus, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { QuotesService } from './quotes.service';

describe('QuotesService', () => {
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
    permissions: ['quotes.send'],
  };
  const tomorrow = new Date(Date.now() + 86_400_000);
  const quote = {
    id: 'quote-1',
    number: 'DEV-2026-000001',
    status: QuoteStatus.DRAFT,
    version: 2,
    issueDate: new Date(),
    validUntil: tomorrow,
    currency: 'XOF',
    notes: null,
    terms: null,
    subtotal: new Prisma.Decimal('0'),
    discountTotal: new Prisma.Decimal('0'),
    taxTotal: new Prisma.Decimal('0'),
    total: new Prisma.Decimal('0'),
    tenantId: 'tenant-1',
    clientId: 'client-1',
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
    createdBy: null,
    lines: [],
    history: [],
  };
  const tx = {
    quote: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  let service: QuotesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (client: typeof tx) => unknown) => operation(tx),
    );
    tx.quote.findFirst.mockResolvedValue(quote);
    service = new QuotesService(prisma as never, audit as never);
  });

  it('détecte une version obsolète avant le changement de statut', async () => {
    await expect(
      service.send(actor, quote.id, { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.quote.update).not.toHaveBeenCalled();
  });

  it('refuse l’envoi d’un devis vide', async () => {
    await expect(
      service.send(actor, quote.id, { version: quote.version }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.quote.update).not.toHaveBeenCalled();
  });

  it('refuse une transition directe de brouillon à accepté', async () => {
    await expect(
      service.transition(actor, quote.id, {
        version: quote.version,
        status: QuoteStatus.ACCEPTED,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
