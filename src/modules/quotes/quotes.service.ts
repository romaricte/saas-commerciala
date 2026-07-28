import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentType,
  Prisma,
  QuoteStatus,
  type Product,
} from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { AuditService } from '@modules/users/audit.service';
import { PrismaService } from '@prisma/prisma.service';
import {
  CreateQuoteDto,
  ListQuotesQueryDto,
  QuoteLineInputDto,
  QuoteVersionDto,
  TransitionQuoteDto,
  UpdateQuoteDto,
} from './dto/quotes.dto';
import {
  calculateQuoteLine,
  calculateQuoteTotals,
  type CalculatedQuoteLine,
} from './quote-calculator';

const quoteDetailInclude = {
  client: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
    },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  lines: {
    orderBy: { position: 'asc' as const },
  },
  history: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      changedBy: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  },
} satisfies Prisma.QuoteInclude;

type QuoteDetail = Prisma.QuoteGetPayload<{
  include: typeof quoteDetailInclude;
}>;

type ResolvedLine = {
  position: number;
  label: string;
  description?: string;
  sku?: string;
  unit: string;
  productId?: string;
  calculation: CalculatedQuoteLine;
};

const STATUS_TRANSITIONS: Readonly<
  Record<QuoteStatus, readonly QuoteStatus[]>
> = {
  [QuoteStatus.DRAFT]: [QuoteStatus.SENT, QuoteStatus.CANCELLED],
  [QuoteStatus.SENT]: [
    QuoteStatus.ACCEPTED,
    QuoteStatus.REJECTED,
    QuoteStatus.EXPIRED,
    QuoteStatus.CANCELLED,
  ],
  [QuoteStatus.ACCEPTED]: [],
  [QuoteStatus.REJECTED]: [],
  [QuoteStatus.EXPIRED]: [],
  [QuoteStatus.CANCELLED]: [],
};

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListQuotesQueryDto) {
    const tenantId = this.requireTenant(actor);
    const search = query.search?.trim();
    const where: Prisma.QuoteWhereInput = {
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
      this.prisma.quote.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, email: true } },
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          _count: { select: { lines: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.quote.count({ where }),
    ]);

    return {
      items: items.map(({ _count, ...quote }) => ({
        ...quote,
        subtotal: quote.subtotal.toFixed(2),
        discountTotal: quote.discountTotal.toFixed(2),
        taxTotal: quote.taxTotal.toFixed(2),
        total: quote.total.toFixed(2),
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

  async findOne(actor: AuthenticatedUser, quoteId: string) {
    return this.toResponse(
      await this.findTenantQuote(this.requireTenant(actor), quoteId),
    );
  }

  async create(actor: AuthenticatedUser, dto: CreateQuoteDto) {
    const tenantId = this.requireTenant(actor);
    const dates = this.resolveDates(dto.issueDate, dto.validUntil);

    return this.serializable(async (tx) => {
      await this.assertTenantClient(tx, tenantId, dto.clientId);
      const lines = await this.resolveLines(
        tx,
        tenantId,
        dto.currency,
        dto.lines,
      );
      const totals = calculateQuoteTotals(
        lines.map((line) => line.calculation),
      );
      const number = await this.nextQuoteNumber(
        tx,
        tenantId,
        dates.issueDate.getUTCFullYear(),
      );
      const quote = await tx.quote.create({
        data: {
          tenantId,
          clientId: dto.clientId,
          createdById: actor.id,
          number,
          issueDate: dates.issueDate,
          validUntil: dates.validUntil,
          currency: dto.currency,
          notes: dto.notes,
          terms: dto.terms,
          ...totals,
          lines: { create: lines.map((line) => this.lineCreateData(line)) },
          history: {
            create: {
              toStatus: QuoteStatus.DRAFT,
              changedById: actor.id,
            },
          },
        },
        include: quoteDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'quote.created',
        targetType: 'quote',
        targetId: quote.id,
        metadata: { number: quote.number, clientId: quote.clientId },
      });
      return this.toResponse(quote);
    });
  }

  async update(actor: AuthenticatedUser, quoteId: string, dto: UpdateQuoteDto) {
    const tenantId = this.requireTenant(actor);
    return this.serializable(async (tx) => {
      const current = await this.findTenantQuoteInTransaction(
        tx,
        tenantId,
        quoteId,
      );
      this.assertVersion(current.version, dto.version);
      this.assertDraft(current.status);

      const clientId = dto.clientId ?? current.clientId;
      if (dto.clientId) {
        await this.assertTenantClient(tx, tenantId, dto.clientId);
      }
      if (dto.currency && !dto.lines && current.lines.length > 0) {
        throw new BadRequestException(
          'Fournissez aussi les lignes pour changer la devise d’un devis non vide',
        );
      }

      const dates = this.resolveDates(
        dto.issueDate ?? this.dateOnly(current.issueDate),
        dto.validUntil ?? this.dateOnly(current.validUntil),
      );
      const currency = dto.currency ?? current.currency;
      const lines =
        dto.lines !== undefined
          ? await this.resolveLines(tx, tenantId, currency, dto.lines)
          : undefined;
      const totals = lines
        ? calculateQuoteTotals(lines.map((line) => line.calculation))
        : undefined;

      const quote = await tx.quote.update({
        where: { id: current.id },
        data: {
          clientId,
          issueDate: dates.issueDate,
          validUntil: dates.validUntil,
          currency,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.terms !== undefined ? { terms: dto.terms } : {}),
          ...(totals ? totals : {}),
          ...(lines
            ? {
                lines: {
                  deleteMany: {},
                  create: lines.map((line) => this.lineCreateData(line)),
                },
              }
            : {}),
          version: { increment: 1 },
        },
        include: quoteDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'quote.updated',
        targetType: 'quote',
        targetId: quote.id,
        metadata: {
          number: quote.number,
          previousVersion: current.version,
          fields: Object.keys(dto).filter((key) => key !== 'version'),
        },
      });
      return this.toResponse(quote);
    });
  }

  async send(actor: AuthenticatedUser, quoteId: string, dto: QuoteVersionDto) {
    return this.changeStatus(actor, quoteId, QuoteStatus.SENT, dto.version);
  }

  async transition(
    actor: AuthenticatedUser,
    quoteId: string,
    dto: TransitionQuoteDto,
  ) {
    return this.changeStatus(
      actor,
      quoteId,
      dto.status,
      dto.version,
      dto.comment,
    );
  }

  async remove(
    actor: AuthenticatedUser,
    quoteId: string,
    dto: QuoteVersionDto,
  ): Promise<void> {
    const tenantId = this.requireTenant(actor);
    await this.serializable(async (tx) => {
      const quote = await this.findTenantQuoteInTransaction(
        tx,
        tenantId,
        quoteId,
      );
      this.assertVersion(quote.version, dto.version);
      this.assertDraft(quote.status);
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'quote.deleted',
        targetType: 'quote',
        targetId: quote.id,
        metadata: { number: quote.number },
      });
      await tx.quote.delete({ where: { id: quote.id } });
    });
  }

  private async changeStatus(
    actor: AuthenticatedUser,
    quoteId: string,
    targetStatus: QuoteStatus,
    version: number,
    comment?: string,
  ) {
    const tenantId = this.requireTenant(actor);
    return this.serializable(async (tx) => {
      const current = await this.findTenantQuoteInTransaction(
        tx,
        tenantId,
        quoteId,
      );
      this.assertVersion(current.version, version);
      if (!STATUS_TRANSITIONS[current.status].includes(targetStatus)) {
        throw new ConflictException(
          `Transition ${current.status} → ${targetStatus} interdite`,
        );
      }
      if (targetStatus === QuoteStatus.SENT) {
        if (current.lines.length === 0) {
          throw new ConflictException('Un devis vide ne peut pas être envoyé');
        }
        if (current.validUntil < this.todayUtc()) {
          throw new ConflictException(
            'La date de validité doit être prolongée avant envoi',
          );
        }
      }
      if (
        targetStatus === QuoteStatus.EXPIRED &&
        current.validUntil >= this.todayUtc()
      ) {
        throw new ConflictException(
          'Un devis encore valide ne peut pas être marqué expiré',
        );
      }

      const quote = await tx.quote.update({
        where: { id: current.id },
        data: {
          status: targetStatus,
          version: { increment: 1 },
          history: {
            create: {
              fromStatus: current.status,
              toStatus: targetStatus,
              comment,
              changedById: actor.id,
            },
          },
        },
        include: quoteDetailInclude,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action:
          targetStatus === QuoteStatus.SENT
            ? 'quote.sent'
            : 'quote.status-changed',
        targetType: 'quote',
        targetId: quote.id,
        metadata: {
          number: quote.number,
          from: current.status,
          to: targetStatus,
        },
      });
      return this.toResponse(quote);
    });
  }

  private async resolveLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    currency: string,
    inputs: readonly QuoteLineInputDto[],
  ): Promise<ResolvedLine[]> {
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
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );

    return inputs.map((input, index) =>
      this.resolveLine(input, index + 1, currency, productById),
    );
  }

  private resolveLine(
    input: QuoteLineInputDto,
    position: number,
    currency: string,
    productById: ReadonlyMap<string, Product>,
  ): ResolvedLine {
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

    const calculation = calculateQuoteLine({
      quantity: input.quantity,
      unitPrice: input.unitPrice ?? product?.salePrice ?? 0,
      discountRate: input.discountRate ?? 0,
      taxRate: input.taxRate ?? product?.taxRate ?? 0,
    });
    return {
      position,
      productId: product?.id,
      label: input.label ?? product?.name ?? '',
      description: input.description ?? product?.description ?? undefined,
      sku: product?.sku ?? undefined,
      unit: input.unit ?? product?.unit ?? 'unit',
      calculation,
    };
  }

  private lineCreateData(line: ResolvedLine) {
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

  private async nextQuoteNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    year: number,
  ): Promise<string> {
    const sequence = await tx.documentSequence.upsert({
      where: {
        tenantId_documentType_year: {
          tenantId,
          documentType: DocumentType.QUOTE,
          year,
        },
      },
      create: {
        tenantId,
        documentType: DocumentType.QUOTE,
        year,
        nextValue: 2,
      },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    return `DEV-${year}-${String(sequence.nextValue - 1).padStart(6, '0')}`;
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
    if (!client) {
      throw new BadRequestException('Client invalide pour ce tenant');
    }
  }

  private async findTenantQuote(
    tenantId: string,
    quoteId: string,
  ): Promise<QuoteDetail> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId },
      include: quoteDetailInclude,
    });
    if (!quote) {
      throw new NotFoundException('Devis introuvable');
    }
    return quote;
  }

  private async findTenantQuoteInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    quoteId: string,
  ): Promise<QuoteDetail> {
    const quote = await tx.quote.findFirst({
      where: { id: quoteId, tenantId },
      include: quoteDetailInclude,
    });
    if (!quote) {
      throw new NotFoundException('Devis introuvable');
    }
    return quote;
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new ConflictException(
        `Version obsolète : rechargez le devis (version courante ${current})`,
      );
    }
  }

  private assertDraft(status: QuoteStatus): void {
    if (status !== QuoteStatus.DRAFT) {
      throw new ConflictException(
        'Seul un devis au brouillon peut être modifié ou supprimé',
      );
    }
  }

  private resolveDates(issueDate?: string, validUntil?: string) {
    const issue = issueDate ? this.parseDateOnly(issueDate) : this.todayUtc();
    const validity = validUntil
      ? this.parseDateOnly(validUntil)
      : new Date(issue.getTime() + 30 * 86_400_000);
    if (validity < issue) {
      throw new BadRequestException(
        'La date de validité doit être postérieure ou égale à la date du devis',
      );
    }
    return { issueDate: issue, validUntil: validity };
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

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException(
      'Le devis a été modifié simultanément, veuillez réessayer',
    );
  }

  private requireTenant(actor: AuthenticatedUser): string {
    if (!actor.tenantId) {
      throw new ForbiddenException('Un contexte tenant est requis');
    }
    return actor.tenantId;
  }

  private toResponse(quote: QuoteDetail) {
    return {
      ...quote,
      subtotal: quote.subtotal.toFixed(2),
      discountTotal: quote.discountTotal.toFixed(2),
      taxTotal: quote.taxTotal.toFixed(2),
      total: quote.total.toFixed(2),
      lines: quote.lines.map((line) => ({
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
    };
  }
}
