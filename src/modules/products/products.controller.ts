import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { PERMISSIONS } from '@common/auth/permission.constants';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { RequireVerifiedEmail } from '@common/decorators/verified-email.decorator';
import {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/products.dto';
import { ProductsService } from './products.service';

@ApiTags('Products & Services')
@ApiBearerAuth()
@RequireVerifiedEmail()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Lister les produits et services du tenant' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.productsService.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_CREATE)
  @ApiOperation({ summary: 'Créer un produit ou un service' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(actor, dto);
  }

  @Get(':productId')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Consulter un article du catalogue' })
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    return this.productsService.findOne(actor, productId);
  }

  @Patch(':productId')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Modifier un article actif' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(actor, productId, dto);
  }

  @Post(':productId/archive')
  @RequirePermissions(PERMISSIONS.PRODUCTS_ARCHIVE)
  @ApiOperation({ summary: 'Archiver un article sans casser les devis' })
  archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    return this.productsService.archive(actor, productId);
  }

  @Post(':productId/restore')
  @RequirePermissions(PERMISSIONS.PRODUCTS_ARCHIVE)
  @ApiOperation({ summary: 'Restaurer un article archivé' })
  restore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    return this.productsService.restore(actor, productId);
  }
}
