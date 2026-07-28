import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CatalogItemType, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { PrismaService } from '@prisma/prisma.service';
import { AuditService } from '@modules/users/audit.service';
import {
  CatalogStateFilter,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/products.dto';

const productSelect = {
  id: true,
  type: true,
  name: true,
  description: true,
  sku: true,
  unit: true,
  salePrice: true,
  costPrice: true,
  taxRate: true,
  currency: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListProductsQueryDto) {
    const tenantId = this.requireTenant(actor);
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.state === CatalogStateFilter.ACTIVE
        ? { archivedAt: null }
        : query.state === CatalogStateFilter.ARCHIVED
          ? { archivedAt: { not: null } }
          : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: productSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((product) => this.toResponse(product)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(actor: AuthenticatedUser, productId: string) {
    return this.toResponse(
      await this.findTenantProduct(this.requireTenant(actor), productId),
    );
  }

  async create(actor: AuthenticatedUser, dto: CreateProductDto) {
    const tenantId = this.requireTenant(actor);
    this.assertPrices(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            tenantId,
            type: dto.type ?? CatalogItemType.PRODUCT,
            name: dto.name,
            description: dto.description,
            sku: dto.sku,
            unit: dto.unit ?? 'unit',
            salePrice: dto.salePrice,
            costPrice: dto.costPrice,
            taxRate: dto.taxRate ?? '0',
            currency: dto.currency ?? 'XOF',
          },
          select: productSelect,
        });
        await this.audit.write(tx, {
          tenantId,
          actorUserId: actor.id,
          action: 'product.created',
          targetType: 'product',
          targetId: product.id,
          metadata: { type: product.type, sku: product.sku },
        });
        return this.toResponse(product);
      });
    } catch (error) {
      this.rethrowUniqueSku(error);
    }
  }

  async update(
    actor: AuthenticatedUser,
    productId: string,
    dto: UpdateProductDto,
  ) {
    const tenantId = this.requireTenant(actor);
    const product = await this.findTenantProduct(tenantId, productId);
    if (product.archivedAt) {
      throw new ConflictException(
        'Un article archivé doit être restauré avant modification',
      );
    }
    this.assertPrices(dto);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
          where: { id: product.id },
          data: dto,
          select: productSelect,
        });
        await this.audit.write(tx, {
          tenantId,
          actorUserId: actor.id,
          action: 'product.updated',
          targetType: 'product',
          targetId: product.id,
          metadata: { fields: Object.keys(dto) },
        });
        return this.toResponse(updated);
      });
    } catch (error) {
      this.rethrowUniqueSku(error);
    }
  }

  async archive(actor: AuthenticatedUser, productId: string) {
    return this.setArchiveState(actor, productId, true);
  }

  async restore(actor: AuthenticatedUser, productId: string) {
    return this.setArchiveState(actor, productId, false);
  }

  private async setArchiveState(
    actor: AuthenticatedUser,
    productId: string,
    archive: boolean,
  ) {
    const tenantId = this.requireTenant(actor);
    const product = await this.findTenantProduct(tenantId, productId);
    if (archive === Boolean(product.archivedAt)) {
      throw new ConflictException(
        archive ? 'Cet article est déjà archivé' : 'Cet article est déjà actif',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: product.id },
        data: { archivedAt: archive ? new Date() : null },
        select: productSelect,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: archive ? 'product.archived' : 'product.restored',
        targetType: 'product',
        targetId: product.id,
      });
      return this.toResponse(updated);
    });
  }

  private async findTenantProduct(
    tenantId: string,
    productId: string,
  ): Promise<ProductRecord> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: productSelect,
    });
    if (!product) {
      throw new NotFoundException('Produit ou service introuvable');
    }
    return product;
  }

  private assertPrices(dto: {
    salePrice?: string;
    costPrice?: string | null;
    taxRate?: string;
  }): void {
    if (
      dto.salePrice !== undefined &&
      new Prisma.Decimal(dto.salePrice).isNegative()
    ) {
      throw new BadRequestException('Le prix de vente doit être positif');
    }
    if (
      dto.costPrice !== undefined &&
      dto.costPrice !== null &&
      new Prisma.Decimal(dto.costPrice).isNegative()
    ) {
      throw new BadRequestException('Le coût de revient doit être positif');
    }
    if (dto.taxRate !== undefined) {
      const rate = new Prisma.Decimal(dto.taxRate);
      if (rate.isNegative() || rate.greaterThan(100)) {
        throw new BadRequestException(
          'Le taux de taxe doit être compris entre 0 et 100',
        );
      }
    }
  }

  private rethrowUniqueSku(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ce SKU existe déjà dans votre catalogue');
    }
    throw error;
  }

  private requireTenant(actor: AuthenticatedUser): string {
    if (!actor.tenantId) {
      throw new ForbiddenException('Un contexte tenant est requis');
    }
    return actor.tenantId;
  }

  private toResponse(product: ProductRecord) {
    return {
      ...product,
      salePrice: product.salePrice.toFixed(2),
      costPrice: product.costPrice?.toFixed(2) ?? null,
      taxRate: product.taxRate.toFixed(2),
      isArchived: Boolean(product.archivedAt),
    };
  }
}
