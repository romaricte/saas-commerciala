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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { PERMISSIONS } from '@common/auth/permission.constants';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { RequireVerifiedEmail } from '@common/decorators/verified-email.decorator';
import {
  AssignUserRolesDto,
  InviteUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@RequireVerifiedEmail()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Lister les utilisateurs du tenant' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.usersService.list(actor, query);
  }

  @Post('invitations')
  @RequirePermissions(PERMISSIONS.USERS_INVITE)
  @ApiOperation({ summary: 'Inviter un collaborateur' })
  invite(@CurrentUser() actor: AuthenticatedUser, @Body() dto: InviteUserDto) {
    return this.usersService.invite(actor, dto);
  }

  @Get('invitations')
  @RequirePermissions(PERMISSIONS.USERS_INVITE)
  @ApiOperation({ summary: 'Lister les invitations du tenant' })
  invitations(@CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.listInvitations(actor);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.USERS_INVITE)
  @ApiOperation({ summary: 'Révoquer une invitation' })
  revokeInvitation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    return this.usersService.revokeInvitation(actor, invitationId);
  }

  @Get(':userId')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Consulter un utilisateur du tenant' })
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.usersService.findOne(actor, userId);
  }

  @Patch(':userId')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ApiOperation({ summary: 'Modifier un utilisateur' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(actor, userId, dto);
  }

  @Patch(':userId/status')
  @RequirePermissions(PERMISSIONS.USERS_CHANGE_STATUS)
  @ApiOperation({ summary: 'Activer ou désactiver un utilisateur' })
  changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.changeStatus(actor, userId, dto);
  }

  @Put(':userId/roles')
  @RequirePermissions(PERMISSIONS.USERS_ASSIGN_ROLES)
  @ApiOperation({ summary: 'Remplacer les rôles d’un utilisateur' })
  assignRoles(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: AssignUserRolesDto,
  ) {
    return this.usersService.assignRoles(actor, userId, dto);
  }

  @Delete(':userId/sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.USERS_REVOKE_SESSIONS)
  @ApiOperation({ summary: 'Révoquer toutes les sessions d’un utilisateur' })
  revokeSessions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.usersService.revokeSessions(actor, userId);
  }
}
