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
  ConvertQuoteToOrderDto,
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderVersionDto,
  TransitionOrderDto,
  UpdateOrderDto,
} from './dto/orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth()
@RequireVerifiedEmail()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: 'Lister les commandes du tenant' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORDERS_CREATE)
  @ApiOperation({ summary: 'Créer une commande manuelle au brouillon' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(actor, dto);
  }

  @Post('from-quote/:quoteId')
  @RequirePermissions(PERMISSIONS.ORDERS_CREATE)
  @ApiOperation({ summary: 'Convertir un devis accepté en commande confirmée' })
  fromQuote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('quoteId') quoteId: string,
    @Body() dto: ConvertQuoteToOrderDto,
  ) {
    return this.ordersService.createFromQuote(actor, quoteId, dto);
  }

  @Get(':orderId')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.findOne(actor, orderId);
  }

  @Patch(':orderId')
  @RequirePermissions(PERMISSIONS.ORDERS_UPDATE)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.ordersService.update(actor, orderId, dto);
  }

  @Post(':orderId/confirm')
  @RequirePermissions(PERMISSIONS.ORDERS_CONFIRM)
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: OrderVersionDto,
  ) {
    return this.ordersService.confirm(actor, orderId, dto);
  }

  @Post(':orderId/transition')
  @RequirePermissions(PERMISSIONS.ORDERS_CHANGE_STATUS)
  transition(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: TransitionOrderDto,
  ) {
    return this.ordersService.transition(actor, orderId, dto);
  }

  @Delete(':orderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.ORDERS_DELETE)
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Query() dto: OrderVersionDto,
  ): Promise<void> {
    return this.ordersService.remove(actor, orderId, dto);
  }
}
