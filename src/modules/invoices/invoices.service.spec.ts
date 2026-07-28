import { ConflictException } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  const actor: AuthenticatedUser = {
    id: 'user-1',
    email: 'compta@acme.test',
    firstName: 'Grace',
    lastName: 'Hopper',
    role: UserRole.MANAGER,
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    emailVerified: true,
    roles: [],
    permissions: ['invoices.issue', 'invoices.manage-payments'],
  };
  const invoice = {
    id: 'invoice-1',
    number: null,
    status: InvoiceStatus.DRAFT,
    paymentStatus: PaymentStatus.UNPAID,
    version: 2,
    invoiceDate: new Date(),
    dueDate: new Date(Date.now() + 86_400_000),
    currency: 'XOF',
    notes: null,
    terms: null,
    subtotal: new Prisma.Decimal('100'),
    discountTotal: new Prisma.Decimal(0),
    taxTotal: new Prisma.Decimal(0),
    total: new Prisma.Decimal('100'),
    amountPaid: new Prisma.Decimal(0),
    balanceDue: new Prisma.Decimal('100'),
    issuedAt: null,
    voidedAt: null,
    voidReason: null,
    tenantId: 'tenant-1',
    clientId: 'client-1',
    orderId: null,
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
    order: null,
    createdBy: null,
    lines: [],
    history: [],
    payments: [],
  };
  const tx = {
    invoice: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      update: jest.fn(),
    },
    documentSequence: {
      upsert: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn() };
  const audit = { write: jest.fn() };
  let service: InvoicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (client: typeof tx) => unknown) => operation(tx),
    );
    tx.invoice.findFirst.mockResolvedValue(invoice);
    service = new InvoicesService(prisma as never, audit as never);
  });

  it('refuse d’émettre une facture vide', async () => {
    await expect(
      service.issue(actor, invoice.id, { version: invoice.version }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.documentSequence.upsert).not.toHaveBeenCalled();
  });

  it('refuse un paiement supérieur au solde', async () => {
    tx.invoice.findFirst.mockResolvedValue({
      ...invoice,
      status: InvoiceStatus.ISSUED,
      number: 'FAC-2026-000001',
    });

    await expect(
      service.recordPayment(actor, invoice.id, {
        invoiceVersion: invoice.version,
        amount: '101.00',
        method: PaymentMethod.BANK_TRANSFER,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('refuse d’annuler une facture déjà encaissée', async () => {
    tx.invoice.findFirst.mockResolvedValue({
      ...invoice,
      status: InvoiceStatus.ISSUED,
      amountPaid: new Prisma.Decimal('20'),
    });

    await expect(
      service.void(actor, invoice.id, {
        version: invoice.version,
        reason: 'Erreur de facturation',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enregistre un paiement partiel et recalcule le solde', async () => {
    const issued = {
      ...invoice,
      status: InvoiceStatus.ISSUED,
      number: 'FAC-2026-000001',
    };
    const payment = {
      id: 'payment-1',
      tenantId: 'tenant-1',
      invoiceId: invoice.id,
      recordedById: actor.id,
      reversedById: null,
      amount: new Prisma.Decimal('40'),
      method: PaymentMethod.BANK_TRANSFER,
      paidAt: new Date(),
      reference: null,
      notes: null,
      reversedAt: null,
      reversalReason: null,
      createdAt: new Date(),
      recordedBy: null,
      reversedBy: null,
    };
    tx.invoice.findFirst.mockResolvedValue(issued);
    tx.payment.create.mockResolvedValue(payment);
    tx.invoice.update.mockResolvedValue({
      ...issued,
      version: 3,
      amountPaid: new Prisma.Decimal('40'),
      balanceDue: new Prisma.Decimal('60'),
      paymentStatus: PaymentStatus.PARTIALLY_PAID,
      payments: [payment],
    });

    const result = await service.recordPayment(actor, invoice.id, {
      invoiceVersion: invoice.version,
      amount: '40.00',
      method: PaymentMethod.BANK_TRANSFER,
    });

    expect(result.amountPaid).toBe('40.00');
    expect(result.balanceDue).toBe('60.00');
    expect(result.paymentStatus).toBe(PaymentStatus.PARTIALLY_PAID);
  });
});
