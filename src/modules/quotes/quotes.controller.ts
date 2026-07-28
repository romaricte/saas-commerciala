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
  CreateQuoteDto,
  ListQuotesQueryDto,
  QuoteVersionDto,
  TransitionQuoteDto,
  UpdateQuoteDto,
} from './dto/quotes.dto';
import { QuotesService } from './quotes.service';

@ApiTags('Quotes')
@ApiBearerAuth()
@RequireVerifiedEmail()
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUOTES_READ)
  @ApiOperation({ summary: 'Lister les devis du tenant' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListQuotesQueryDto,
  ) {
    return this.quotesService.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUOTES_CREATE)
  @ApiOperation({ summary: 'Créer un devis au brouillon' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateQuoteDto) {
    return this.quotesService.create(actor, dto);
  }

  @Get(':quoteId')
  @RequirePermissions(PERMISSIONS.QUOTES_READ)
  @ApiOperation({ summary: 'Consulter un devis, ses lignes et son historique' })
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('quoteId') quoteId: string,
  ) {
    return this.quotesService.findOne(actor, quoteId);
  }

  @Patch(':quoteId')
  @RequirePermissions(PERMISSIONS.QUOTES_UPDATE)
  @ApiOperation({ summary: 'Modifier atomiquement un devis au brouillon' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('quoteId') quoteId: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotesService.update(actor, quoteId, dto);
  }

  @Post(':quoteId/send')
  @RequirePermissions(PERMISSIONS.QUOTES_SEND)
  @ApiOperation({ summary: 'Faire passer un devis de brouillon à envoyé' })
  send(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('quoteId') quoteId: string,
    @Body() dto: QuoteVersionDto,
  ) {
    return this.quotesService.send(actor, quoteId, dto);
  }

  @Post(':quoteId/transition')
  @RequirePermissions(PERMISSIONS.QUOTES_CHANGE_STATUS)
  @ApiOperation({ summary: 'Accepter, refuser, expirer ou annuler un devis' })
  transition(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('quoteId') quoteId: string,
    @Body() dto: TransitionQuoteDto,
  ) {
    return this.quotesService.transition(actor, quoteId, dto);
  }

  @Delete(':quoteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.QUOTES_DELETE)
  @ApiOperation({ summary: 'Supprimer un devis au brouillon' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('quoteId') quoteId: string,
    @Query() dto: QuoteVersionDto,
  ): Promise<void> {
    return this.quotesService.remove(actor, quoteId, dto);
  }
}
