import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ConvertOrderToInvoiceDto,
  CreateInvoiceDto,
  InvoiceVersionDto,
  ListInvoicesQueryDto,
  RecordPaymentDto,
  ReversePaymentDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
} from './dto/invoices.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Invoices')
@ApiBearerAuth()
@RequireVerifiedEmail()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListInvoicesQueryDto,
  ) {
    return this.invoicesService.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVOICES_CREATE)
  @ApiOperation({ summary: 'Créer une facture manuelle au brouillon' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(actor, dto);
  }

  @Post('from-order/:orderId')
  @RequirePermissions(PERMISSIONS.INVOICES_CREATE)
  @ApiOperation({ summary: 'Créer une facture depuis une commande confirmée' })
  fromOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: ConvertOrderToInvoiceDto,
  ) {
    return this.invoicesService.createFromOrder(actor, orderId, dto);
  }

  @Get(':invoiceId')
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.invoicesService.findOne(actor, invoiceId);
  }

  @Patch(':invoiceId')
  @RequirePermissions(PERMISSIONS.INVOICES_UPDATE)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(actor, invoiceId, dto);
  }

  @Post(':invoiceId/issue')
  @RequirePermissions(PERMISSIONS.INVOICES_ISSUE)
  issue(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: InvoiceVersionDto,
  ) {
    return this.invoicesService.issue(actor, invoiceId, dto);
  }

  @Post(':invoiceId/void')
  @RequirePermissions(PERMISSIONS.INVOICES_VOID)
  void(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    return this.invoicesService.void(actor, invoiceId, dto);
  }

  @Post(':invoiceId/payments')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE_PAYMENTS)
  recordPayment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.invoicesService.recordPayment(actor, invoiceId, dto);
  }

  @Post(':invoiceId/payments/:paymentId/reverse')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE_PAYMENTS)
  reversePayment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: ReversePaymentDto,
  ) {
    return this.invoicesService.reversePayment(
      actor,
      invoiceId,
      paymentId,
      dto,
    );
  }

  @Delete(':invoiceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.INVOICES_DELETE)
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Query() dto: InvoiceVersionDto,
  ): Promise<void> {
    return this.invoicesService.remove(actor, invoiceId, dto);
  }
}
