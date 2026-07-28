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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { PERMISSIONS } from '@common/auth/permission.constants';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { RequireVerifiedEmail } from '@common/decorators/verified-email.decorator';
import {
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/roles.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@ApiBearerAuth()
@RequireVerifiedEmail()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Lister les rôles du tenant' })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.rolesService.list(actor);
  }

  @Get(':roleId')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Consulter un rôle' })
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('roleId') roleId: string,
  ) {
    return this.rolesService.findOne(actor, roleId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROLES_CREATE)
  @ApiOperation({ summary: 'Créer un rôle personnalisé' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(actor, dto);
  }

  @Patch(':roleId')
  @RequirePermissions(PERMISSIONS.ROLES_UPDATE)
  @ApiOperation({ summary: 'Modifier un rôle personnalisé' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(actor, roleId, dto);
  }

  @Put(':roleId/permissions')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE_PERMISSIONS)
  @ApiOperation({ summary: 'Remplacer les permissions d’un rôle' })
  setPermissions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('roleId') roleId: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rolesService.setPermissions(actor, roleId, dto);
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.ROLES_DELETE)
  @ApiOperation({ summary: 'Supprimer un rôle personnalisé inutilisé' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('roleId') roleId: string,
  ): Promise<void> {
    return this.rolesService.remove(actor, roleId);
  }
}
