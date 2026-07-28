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
  Prisma,
  QuoteStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import {
  commercialLineCreateData,
  resolveCommercialLines,
} from '@common/commerce/commercial-document-lines';
import { calculateDocumentTotals } from '@common/commerce/commercial-document-calculator';
import { runSerializable } from '@common/commerce/serializable-transaction';
import { AuditService } from '@modules/users/audit.service';
import { PrismaService } from '@prisma/prisma.service';
import {
  ConvertQuoteToOrderDto,
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderVersionDto,
  TransitionOrderDto,
  UpdateOrderDto,
} from './dto/orders.dto';

const orderDetailInclude = {
  client: {
    select: { id: true, name: true, email: true, phone: true, address: true },
  },
  quote: { select: { id: true, number: true, status: true } },
  invoice: { select: { id: true, number: true, status: true } },
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
} satisfies Prisma.SalesOrderInclude;

type OrderDetail = Prisma.SalesOrderGetPayload<{
  include: typeof orderDetailInclude;
}>;

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.DRAFT]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.IN_PROGRESS, OrderStatus.CANCELLED],
  [OrderStatus.IN_PROGRESS]: [OrderStatus.FULFILLED, OrderStatus.CANCELLED],
  [OrderStatus.FULFILLED]: [],
  [OrderStatus.CANCELLED]: [],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListOrdersQueryDto) {
    const tenantId = this.requireTenant(actor);
    const search = query.search?.trim();
    const where: Prisma.SalesOrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
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
      this.prisma.salesOrder.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, email: true } },
          quote: { select: { id: true, number: true } },
          invoice: { select: { id: true, number: true, status: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return {
      items: items.map(({ _count, ...order }) => ({
        ...this.moneyResponse(order),
        lineCount: _count.lines,
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(actor: AuthenticatedUser, orderId: string) {
    return this.toResponse(
      await this.findTenantOrder(this.requireTenant(actor), orderId),
    );
  }

  async create(actor: AuthenticatedUser, dto: CreateOrderDto) {
    const tenantId = this.requireTenant(actor);
    const dates = this.resolveDates(dto.orderDate, dto.expectedDeliveryDate);
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
      const number = await this.nextNumber(
        tx,
        tenantId,
        dates.orderDate.getUTCFullYear(),
      );
      const order = await tx.salesOrder.create({
        data: {
          tenantId,
          clientId: dto.clientId,
          createdById: actor.id,
          number,
          orderDate: dates.orderDate,
          expectedDeliveryDate: dates.expectedDeliveryDate,
          currency: dto.currency,
          notes: dto.notes,
          ...totals,
          lines: {
            create: lines.map((line) => commercialLineCreateData(line)),
          },
          history: {
            create: { toStatus: OrderStatus.DRAFT, changedById: actor.id },
          },
        },
        include: orderDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'order.created',
        targetType: 'sales_order',
        targetId: order.id,
        metadata: { number: order.number, clientId: order.clientId },
      });
      return this.toResponse(order);
    });
  }

  async createFromQuote(
    actor: AuthenticatedUser,
    quoteId: string,
    dto: ConvertQuoteToOrderDto,
  ) {
    const tenantId = this.requireTenant(actor);
    try {
      return await runSerializable(this.prisma, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: quoteId, tenantId },
          include: { lines: { orderBy: { position: 'asc' } }, order: true },
        });
        if (!quote) throw new NotFoundException('Devis introuvable');
        if (quote.status !== QuoteStatus.ACCEPTED) {
          throw new ConflictException(
            'Seul un devis accepté peut devenir une commande',
          );
        }
        if (quote.order) {
          throw new ConflictException('Ce devis possède déjà une commande');
        }
        const orderDate = this.todayUtc();
        const expectedDeliveryDate = dto.expectedDeliveryDate
          ? this.parseDateOnly(dto.expectedDeliveryDate)
          : undefined;
        if (expectedDeliveryDate && expectedDeliveryDate < orderDate) {
          throw new BadRequestException(
            'La livraison prévue ne peut pas précéder la commande',
          );
        }
        const number = await this.nextNumber(
          tx,
          tenantId,
          orderDate.getUTCFullYear(),
        );
        const order = await tx.salesOrder.create({
          data: {
            tenantId,
            clientId: quote.clientId,
            quoteId: quote.id,
            createdById: actor.id,
            number,
            status: OrderStatus.CONFIRMED,
            orderDate,
            expectedDeliveryDate,
            currency: quote.currency,
            notes: dto.notes ?? quote.notes,
            subtotal: quote.subtotal,
            discountTotal: quote.discountTotal,
            taxTotal: quote.taxTotal,
            total: quote.total,
            lines: {
              create: quote.lines.map((line) => ({
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
                toStatus: OrderStatus.CONFIRMED,
                comment: `Créée depuis le devis ${quote.number}`,
                changedById: actor.id,
              },
            },
          },
          include: orderDetailInclude,
        });
        await this.audit.write(tx, {
          tenantId,
          actorUserId: actor.id,
          action: 'order.created-from-quote',
          targetType: 'sales_order',
          targetId: order.id,
          metadata: { number: order.number, quoteId: quote.id },
        });
        return this.toResponse(order);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ce devis possède déjà une commande');
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedUser, orderId: string, dto: UpdateOrderDto) {
    const tenantId = this.requireTenant(actor);
    return runSerializable(this.prisma, async (tx) => {
      const current = await this.findTenantOrderTx(tx, tenantId, orderId);
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
        dto.orderDate ?? this.dateOnly(current.orderDate),
        dto.expectedDeliveryDate === undefined
          ? current.expectedDeliveryDate
            ? this.dateOnly(current.expectedDeliveryDate)
            : undefined
          : dto.expectedDeliveryDate,
      );
      const currency = dto.currency ?? current.currency;
      const lines =
        dto.lines !== undefined
          ? await resolveCommercialLines(tx, tenantId, currency, dto.lines)
          : undefined;
      const totals = lines
        ? calculateDocumentTotals(lines.map((line) => line.calculation))
        : undefined;
      const order = await tx.salesOrder.update({
        where: { id: current.id },
        data: {
          clientId: dto.clientId ?? current.clientId,
          orderDate: dates.orderDate,
          expectedDeliveryDate: dates.expectedDeliveryDate,
          currency,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(totals ?? {}),
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
        include: orderDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'order.updated',
        targetType: 'sales_order',
        targetId: order.id,
        metadata: { previousVersion: current.version },
      });
      return this.toResponse(order);
    });
  }

  confirm(actor: AuthenticatedUser, orderId: string, dto: OrderVersionDto) {
    return this.changeStatus(
      actor,
      orderId,
      OrderStatus.CONFIRMED,
      dto.version,
    );
  }

  transition(
    actor: AuthenticatedUser,
    orderId: string,
    dto: TransitionOrderDto,
  ) {
    return this.changeStatus(
      actor,
      orderId,
      dto.status,
      dto.version,
      dto.comment,
    );
  }

  async remove(
    actor: AuthenticatedUser,
    orderId: string,
    dto: OrderVersionDto,
  ): Promise<void> {
    const tenantId = this.requireTenant(actor);
    await runSerializable(this.prisma, async (tx) => {
      const order = await this.findTenantOrderTx(tx, tenantId, orderId);
      this.assertVersion(order.version, dto.version);
      this.assertDraft(order.status);
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'order.deleted',
        targetType: 'sales_order',
        targetId: order.id,
        metadata: { number: order.number },
      });
      await tx.salesOrder.delete({ where: { id: order.id } });
    });
  }

  private async changeStatus(
    actor: AuthenticatedUser,
    orderId: string,
    target: OrderStatus,
    version: number,
    comment?: string,
  ) {
    const tenantId = this.requireTenant(actor);
    return runSerializable(this.prisma, async (tx) => {
      const current = await this.findTenantOrderTx(tx, tenantId, orderId);
      this.assertVersion(current.version, version);
      if (!TRANSITIONS[current.status].includes(target)) {
        throw new ConflictException(
          `Transition ${current.status} → ${target} interdite`,
        );
      }
      if (target === OrderStatus.CONFIRMED && current.lines.length === 0) {
        throw new ConflictException(
          'Une commande vide ne peut pas être confirmée',
        );
      }
      if (
        target === OrderStatus.CANCELLED &&
        current.invoice &&
        current.invoice.status !== InvoiceStatus.VOID
      ) {
        throw new ConflictException(
          'Annulez ou supprimez d’abord la facture liée',
        );
      }
      const order = await tx.salesOrder.update({
        where: { id: current.id },
        data: {
          status: target,
          version: { increment: 1 },
          history: {
            create: {
              fromStatus: current.status,
              toStatus: target,
              comment,
              changedById: actor.id,
            },
          },
        },
        include: orderDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'order.status-changed',
        targetType: 'sales_order',
        targetId: order.id,
        metadata: { from: current.status, to: target },
      });
      return this.toResponse(order);
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
          documentType: DocumentType.ORDER,
          year,
        },
      },
      create: {
        tenantId,
        documentType: DocumentType.ORDER,
        year,
        nextValue: 2,
      },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    return `CMD-${year}-${String(sequence.nextValue - 1).padStart(6, '0')}`;
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

  private async findTenantOrder(
    tenantId: string,
    orderId: string,
  ): Promise<OrderDetail> {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: orderId, tenantId },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Commande introuvable');
    return order;
  }

  private async findTenantOrderTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
  ): Promise<OrderDetail> {
    const order = await tx.salesOrder.findFirst({
      where: { id: orderId, tenantId },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Commande introuvable');
    return order;
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new ConflictException(
        `Version obsolète : rechargez la commande (version ${current})`,
      );
    }
  }

  private assertDraft(status: OrderStatus): void {
    if (status !== OrderStatus.DRAFT) {
      throw new ConflictException(
        'Seule une commande au brouillon peut être modifiée ou supprimée',
      );
    }
  }

  private resolveDates(orderDate?: string, deliveryDate?: string) {
    const order = orderDate ? this.parseDateOnly(orderDate) : this.todayUtc();
    const delivery = deliveryDate
      ? this.parseDateOnly(deliveryDate)
      : undefined;
    if (delivery && delivery < order) {
      throw new BadRequestException(
        'La livraison prévue ne peut pas précéder la commande',
      );
    }
    return { orderDate: order, expectedDeliveryDate: delivery };
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

  private requireTenant(actor: AuthenticatedUser): string {
    if (!actor.tenantId) {
      throw new ForbiddenException('Un contexte tenant est requis');
    }
    return actor.tenantId;
  }

  private moneyResponse<
    T extends {
      subtotal: Prisma.Decimal;
      discountTotal: Prisma.Decimal;
      taxTotal: Prisma.Decimal;
      total: Prisma.Decimal;
    },
  >(value: T) {
    return {
      ...value,
      subtotal: value.subtotal.toFixed(2),
      discountTotal: value.discountTotal.toFixed(2),
      taxTotal: value.taxTotal.toFixed(2),
      total: value.total.toFixed(2),
    };
  }

  private toResponse(order: OrderDetail) {
    return {
      ...this.moneyResponse(order),
      lines: order.lines.map((line) => ({
        ...this.moneyResponse(line),
        quantity: line.quantity.toFixed(3),
        unitPrice: line.unitPrice.toFixed(2),
        discountRate: line.discountRate.toFixed(2),
        taxRate: line.taxRate.toFixed(2),
      })),
    };
  }
}
