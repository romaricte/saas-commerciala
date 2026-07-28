import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { PERMISSIONS } from '@common/auth/permission.constants';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { RequireVerifiedEmail } from '@common/decorators/verified-email.decorator';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/users.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@RequireVerifiedEmail()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Consulter le journal d’audit du tenant' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: AuditLogQueryDto,
  ) {
    return this.auditService.list(actor, query);
  }
}
