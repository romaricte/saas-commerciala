import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentType,
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import {
  commercialLineCreateData,
  resolveCommercialLines,
} from '@common/commerce/commercial-document-lines';
import {
  calculateDocumentTotals,
  money,
} from '@common/commerce/commercial-document-calculator';
import { runSerializable } from '@common/commerce/serializable-transaction';
import { AuditService } from '@modules/users/audit.service';
import { PrismaService } from '@prisma/prisma.service';
import {
  ConvertOrderToInvoiceDto,
  CreateInvoiceDto,
  InvoiceVersionDto,
  ListInvoicesQueryDto,
  RecordPaymentDto,
  ReversePaymentDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
} from './dto/invoices.dto';

const invoiceDetailInclude = {
  client: {
    select: { id: true, name: true, email: true, phone: true, address: true },
  },
  order: { select: { id: true, number: true, status: true } },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  lines: { orderBy: { position: 'asc' as const } },
  history: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      changedBy: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  },
  payments: {
    orderBy: [{ paidAt: 'desc' as const }, { createdAt: 'desc' as const }],
    include: {
      recordedBy: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      reversedBy: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceDetail = Prisma.InvoiceGetPayload<{
  include: typeof invoiceDetailInclude;
}>;

const INVOICEABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.FULFILLED,
];

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListInvoicesQueryDto) {
    const tenantId = this.requireTenant(actor);
    const search = query.search?.trim();
    const overdueWhere =
      query.overdue === undefined
        ? {}
        : query.overdue
          ? {
              status: InvoiceStatus.ISSUED,
              paymentStatus: { not: PaymentStatus.PAID },
              dueDate: { lt: this.todayUtc() },
            }
          : {
              NOT: {
                status: InvoiceStatus.ISSUED,
                paymentStatus: { not: PaymentStatus.PAID },
                dueDate: { lt: this.todayUtc() },
              },
            };
    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...overdueWhere,
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              {
                client: {
                  name: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, email: true } },
          order: { select: { id: true, number: true } },
          _count: { select: { lines: true, payments: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      items: items.map(({ _count, ...invoice }) => ({
        ...this.invoiceMoneyResponse(invoice),
        lineCount: _count.lines,
        paymentCount: _count.payments,
        isOverdue: this.isOverdue(invoice),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(actor: AuthenticatedUser, invoiceId: string) {
    return this.toResponse(
      await this.findTenantInvoice(this.requireTenant(actor), invoiceId),
    );
  }

  async create(actor: AuthenticatedUser, dto: CreateInvoiceDto) {
    const tenantId = this.requireTenant(actor);
    const dates = this.resolveDates(dto.invoiceDate, dto.dueDate);
    return runSerializable(this.prisma, async (tx) => {
      await this.assertTenantClient(tx, tenantId, dto.clientId);
      const lines = await resolveCommercialLines(
        tx,
        tenantId,
        dto.currency,
        dto.lines,
      );
      const totals = calculateDocumentTotals(
        lines.map((line) => line.calculation),
      );
      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          clientId: dto.clientId,
          createdById: actor.id,
          invoiceDate: dates.invoiceDate,
          dueDate: dates.dueDate,
          currency: dto.currency,
          notes: dto.notes,
          terms: dto.terms,
          ...totals,
          balanceDue: totals.total,
          lines: {
            create: lines.map((line) => commercialLineCreateData(line)),
          },
          history: {
            create: { toStatus: InvoiceStatus.DRAFT, changedById: actor.id },
          },
        },
        include: invoiceDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'invoice.created',
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: { clientId: invoice.clientId },
      });
      return this.toResponse(invoice);
    });
  }

  async createFromOrder(
    actor: AuthenticatedUser,
    orderId: string,
    dto: ConvertOrderToInvoiceDto,
  ) {
    const tenantId = this.requireTenant(actor);
    try {
      return await runSerializable(this.prisma, async (tx) => {
        const order = await tx.salesOrder.findFirst({
          where: { id: orderId, tenantId },
          include: { lines: { orderBy: { position: 'asc' } }, invoice: true },
        });
        if (!order) throw new NotFoundException('Commande introuvable');
        if (!INVOICEABLE_ORDER_STATUSES.includes(order.status)) {
          throw new ConflictException(
            'La commande doit être confirmée avant facturation',
          );
        }
        if (order.invoice) {
          throw new ConflictException('Cette commande est déjà facturée');
        }
        const dates = this.resolveDates(dto.invoiceDate, dto.dueDate);
        const invoice = await tx.invoice.create({
          data: {
            tenantId,
            clientId: order.clientId,
            orderId: order.id,
            createdById: actor.id,
            invoiceDate: dates.invoiceDate,
            dueDate: dates.dueDate,
            currency: order.currency,
            notes: dto.notes ?? order.notes,
            terms: dto.terms,
            subtotal: order.subtotal,
            discountTotal: order.discountTotal,
            taxTotal: order.taxTotal,
            total: order.total,
            balanceDue: order.total,
            lines: {
              create: order.lines.map((line) => ({
                position: line.position,
                label: line.label,
                description: line.description,
                sku: line.sku,
                unit: line.unit,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountRate: line.discountRate,
                taxRate: line.taxRate,
                subtotal: line.subtotal,
                discountTotal: line.discountTotal,
                taxTotal: line.taxTotal,
                total: line.total,
                productId: line.productId,
              })),
            },
            history: {
              create: {
                toStatus: InvoiceStatus.DRAFT,
                comment: `Créée depuis la commande ${order.number}`,
                changedById: actor.id,
              },
            },
          },
          include: invoiceDetailInclude,
        });
        await this.audit.write(tx, {
          tenantId,
          actorUserId: actor.id,
          action: 'invoice.created-from-order',
          targetType: 'invoice',
          targetId: invoice.id,
          metadata: { orderId: order.id },
        });
        return this.toResponse(invoice);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Cette commande est déjà facturée');
      }
      throw error;
    }
  }

  async update(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ) {
    const tenantId = this.requireTenant(actor);
    return runSerializable(this.prisma, async (tx) => {
      const current = await this.findTenantInvoiceTx(tx, tenantId, invoiceId);
      this.assertVersion(current.version, dto.version);
      this.assertDraft(current.status);
      if (dto.clientId) {
        await this.assertTenantClient(tx, tenantId, dto.clientId);
      }
      if (dto.currency && !dto.lines && current.lines.length > 0) {
        throw new BadRequestException(
          'Fournissez les lignes pour changer la devise',
        );
      }
      const dates = this.resolveDates(
        dto.invoiceDate ?? this.dateOnly(current.invoiceDate),
        dto.dueDate ?? this.dateOnly(current.dueDate),
      );
      const currency = dto.currency ?? current.currency;
      const lines =
        dto.lines !== undefined
          ? await resolveCommercialLines(tx, tenantId, currency, dto.lines)
          : undefined;
      const totals = lines
        ? calculateDocumentTotals(lines.map((line) => line.calculation))
        : undefined;
      const invoice = await tx.invoice.update({
        where: { id: current.id },
        data: {
          clientId: dto.clientId ?? current.clientId,
          invoiceDate: dates.invoiceDate,
          dueDate: dates.dueDate,
          currency,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.terms !== undefined ? { terms: dto.terms } : {}),
          ...(totals ? { ...totals, balanceDue: totals.total } : {}),
          ...(lines
            ? {
                lines: {
                  deleteMany: {},
                  create: lines.map((line) => commercialLineCreateData(line)),
                },
              }
            : {}),
          version: { increment: 1 },
        },
        include: invoiceDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'invoice.updated',
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: { previousVersion: current.version },
      });
      return this.toResponse(invoice);
    });
  }

  async issue(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: InvoiceVersionDto,
  ) {
    const tenantId = this.requireTenant(actor);
    return runSerializable(this.prisma, async (tx) => {
      const current = await this.findTenantInvoiceTx(tx, tenantId, invoiceId);
      this.assertVersion(current.version, dto.version);
      this.assertDraft(current.status);
      if (current.lines.length === 0) {
        throw new ConflictException('Une facture vide ne peut pas être émise');
      }
      const number = await this.nextNumber(
        tx,
        tenantId,
        current.invoiceDate.getUTCFullYear(),
      );
      const invoice = await tx.invoice.update({
        where: { id: current.id },
        data: {
          number,
          status: InvoiceStatus.ISSUED,
          issuedAt: new Date(),
          version: { increment: 1 },
          history: {
            create: {
              fromStatus: InvoiceStatus.DRAFT,
              toStatus: InvoiceStatus.ISSUED,
              changedById: actor.id,
            },
          },
        },
        include: invoiceDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'invoice.issued',
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: { number },
      });
      return this.toResponse(invoice);
    });
  }

  async void(actor: AuthenticatedUser, invoiceId: string, dto: VoidInvoiceDto) {
    const tenantId = this.requireTenant(actor);
    return runSerializable(this.prisma, async (tx) => {
      const current = await this.findTenantInvoiceTx(tx, tenantId, invoiceId);
      this.assertVersion(current.version, dto.version);
      if (current.status !== InvoiceStatus.ISSUED) {
        throw new ConflictException(
          'Seule une facture émise peut être annulée',
        );
      }
      if (!current.amountPaid.isZero()) {
        throw new ConflictException(
          'Une facture encaissée nécessite un remboursement ou un avoir',
        );
      }
      const invoice = await tx.invoice.update({
        where: { id: current.id },
        data: {
          status: InvoiceStatus.VOID,
          voidedAt: new Date(),
          voidReason: dto.reason,
          version: { increment: 1 },
          history: {
            create: {
              fromStatus: InvoiceStatus.ISSUED,
              toStatus: InvoiceStatus.VOID,
              comment: dto.reason,
              changedById: actor.id,
            },
          },
        },
        include: invoiceDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'invoice.voided',
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: { number: invoice.number, reason: dto.reason },
      });
      return this.toResponse(invoice);
    });
  }

  async recordPayment(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: RecordPaymentDto,
  ) {
    const tenantId = this.requireTenant(actor);
    return runSerializable(this.prisma, async (tx) => {
      const current = await this.findTenantInvoiceTx(tx, tenantId, invoiceId);
      this.assertVersion(current.version, dto.invoiceVersion);
      if (current.status !== InvoiceStatus.ISSUED) {
        throw new ConflictException(
          'Les paiements concernent uniquement une facture émise',
        );
      }
      const amount = money(dto.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'Le montant du paiement doit être positif',
        );
      }
      if (amount.greaterThan(current.balanceDue)) {
        throw new ConflictException(
          'Le paiement dépasse le solde restant de la facture',
        );
      }
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
      if (paidAt > new Date()) {
        throw new BadRequestException(
          'La date de paiement ne peut pas être future',
        );
      }
      const amountPaid = money(current.amountPaid.plus(amount));
      const balanceDue = money(current.balanceDue.minus(amount));
      const paymentStatus = balanceDue.isZero()
        ? PaymentStatus.PAID
        : PaymentStatus.PARTIALLY_PAID;
      const payment = await tx.payment.create({
        data: {
          tenantId,
          invoiceId: current.id,
          recordedById: actor.id,
          amount,
          method: dto.method,
          paidAt,
          reference: dto.reference,
          notes: dto.notes,
        },
      });
      const invoice = await tx.invoice.update({
        where: { id: current.id },
        data: {
          amountPaid,
          balanceDue,
          paymentStatus,
          version: { increment: 1 },
        },
        include: invoiceDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'invoice.payment-recorded',
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: {
          paymentId: payment.id,
          amount: amount.toFixed(2),
          method: dto.method,
        },
      });
      return this.toResponse(invoice);
    });
  }

  async reversePayment(
    actor: AuthenticatedUser,
    invoiceId: string,
    paymentId: string,
    dto: ReversePaymentDto,
  ) {
    const tenantId = this.requireTenant(actor);
    return runSerializable(this.prisma, async (tx) => {
      const current = await this.findTenantInvoiceTx(tx, tenantId, invoiceId);
      this.assertVersion(current.version, dto.invoiceVersion);
      const payment = current.payments.find(
        (candidate) => candidate.id === paymentId,
      );
      if (!payment) throw new NotFoundException('Paiement introuvable');
      if (payment.reversedAt) {
        throw new ConflictException('Ce paiement est déjà contrepassé');
      }
      const amountPaid = money(current.amountPaid.minus(payment.amount));
      const balanceDue = money(current.balanceDue.plus(payment.amount));
      const paymentStatus = amountPaid.isZero()
        ? PaymentStatus.UNPAID
        : PaymentStatus.PARTIALLY_PAID;
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          reversedAt: new Date(),
          reversedById: actor.id,
          reversalReason: dto.reason,
        },
      });
      const invoice = await tx.invoice.update({
        where: { id: current.id },
        data: {
          amountPaid,
          balanceDue,
          paymentStatus,
          version: { increment: 1 },
        },
        include: invoiceDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'invoice.payment-reversed',
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: { paymentId: payment.id, reason: dto.reason },
      });
      return this.toResponse(invoice);
    });
  }

  async remove(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: InvoiceVersionDto,
  ): Promise<void> {
    const tenantId = this.requireTenant(actor);
    await runSerializable(this.prisma, async (tx) => {
      const invoice = await this.findTenantInvoiceTx(tx, tenantId, invoiceId);
      this.assertVersion(invoice.version, dto.version);
      this.assertDraft(invoice.status);
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'invoice.deleted',
        targetType: 'invoice',
        targetId: invoice.id,
      });
      await tx.invoice.delete({ where: { id: invoice.id } });
    });
  }

  private async nextNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    year: number,
  ): Promise<string> {
    const sequence = await tx.documentSequence.upsert({
      where: {
        tenantId_documentType_year: {
          tenantId,
          documentType: DocumentType.INVOICE,
          year,
        },
      },
      create: {
        tenantId,
        documentType: DocumentType.INVOICE,
        year,
        nextValue: 2,
      },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    return `FAC-${year}-${String(sequence.nextValue - 1).padStart(6, '0')}`;
  }

  private async assertTenantClient(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientId: string,
  ): Promise<void> {
    const client = await tx.client.findFirst({
      where: { id: clientId, tenantId },
      select: { id: true },
    });
    if (!client)
      throw new BadRequestException('Client invalide pour ce tenant');
  }

  private async findTenantInvoice(
    tenantId: string,
    invoiceId: string,
  ): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: invoiceDetailInclude,
    });
    if (!invoice) throw new NotFoundException('Facture introuvable');
    return invoice;
  }

  private async findTenantInvoiceTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ): Promise<InvoiceDetail> {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: invoiceDetailInclude,
    });
    if (!invoice) throw new NotFoundException('Facture introuvable');
    return invoice;
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new ConflictException(
        `Version obsolète : rechargez la facture (version ${current})`,
      );
    }
  }

  private assertDraft(status: InvoiceStatus): void {
    if (status !== InvoiceStatus.DRAFT) {
      throw new ConflictException(
        'Seule une facture au brouillon peut être modifiée ou supprimée',
      );
    }
  }

  private resolveDates(invoiceDate?: string, dueDate?: string) {
    const invoice = invoiceDate
      ? this.parseDateOnly(invoiceDate)
      : this.todayUtc();
    const due = dueDate
      ? this.parseDateOnly(dueDate)
      : new Date(invoice.getTime() + 30 * 86_400_000);
    if (due < invoice) {
      throw new BadRequestException(
        'L’échéance ne peut pas précéder la date de facture',
      );
    }
    return { invoiceDate: invoice, dueDate: due };
  }

  private parseDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private todayUtc(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private isOverdue(invoice: {
    status: InvoiceStatus;
    paymentStatus: PaymentStatus;
    dueDate: Date;
  }): boolean {
    return (
      invoice.status === InvoiceStatus.ISSUED &&
      invoice.paymentStatus !== PaymentStatus.PAID &&
      invoice.dueDate < this.todayUtc()
    );
  }

  private requireTenant(actor: AuthenticatedUser): string {
    if (!actor.tenantId) {
      throw new ForbiddenException('Un contexte tenant est requis');
    }
    return actor.tenantId;
  }

  private invoiceMoneyResponse<
    T extends {
      subtotal: Prisma.Decimal;
      discountTotal: Prisma.Decimal;
      taxTotal: Prisma.Decimal;
      total: Prisma.Decimal;
      amountPaid: Prisma.Decimal;
      balanceDue: Prisma.Decimal;
    },
  >(invoice: T) {
    return {
      ...invoice,
      subtotal: invoice.subtotal.toFixed(2),
      discountTotal: invoice.discountTotal.toFixed(2),
      taxTotal: invoice.taxTotal.toFixed(2),
      total: invoice.total.toFixed(2),
      amountPaid: invoice.amountPaid.toFixed(2),
      balanceDue: invoice.balanceDue.toFixed(2),
    };
  }

  private toResponse(invoice: InvoiceDetail) {
    return {
      ...this.invoiceMoneyResponse(invoice),
      isOverdue: this.isOverdue(invoice),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: line.quantity.toFixed(3),
        unitPrice: line.unitPrice.toFixed(2),
        discountRate: line.discountRate.toFixed(2),
        taxRate: line.taxRate.toFixed(2),
        subtotal: line.subtotal.toFixed(2),
        discountTotal: line.discountTotal.toFixed(2),
        taxTotal: line.taxTotal.toFixed(2),
        total: line.total.toFixed(2),
      })),
      payments: invoice.payments.map((payment) => ({
        ...payment,
        amount: payment.amount.toFixed(2),
        isReversed: Boolean(payment.reversedAt),
      })),
    };
  }
}
