import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@prisma/prisma.service';
import { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { AuthMailService } from '@modules/auth/auth-mail.service';
import { AuthTokenService } from '@modules/auth/auth-token.service';
import { PasswordService } from '@modules/auth/password.service';
import { AuditService } from './audit.service';
import {
  AcceptInvitationDto,
  AssignUserRolesDto,
  InviteUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto/users.dto';

const managedUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roleAssignments: {
    select: {
      role: {
        select: {
          id: true,
          name: true,
          slug: true,
          rank: true,
          systemRole: true,
          isSystem: true,
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type ManagedUser = Prisma.UserGetPayload<{
  select: typeof managedUserSelect;
}>;

@Injectable()
export class UsersService {
  private readonly invitationTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokenService,
    private readonly passwords: PasswordService,
    private readonly mailer: AuthMailService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.invitationTtlSeconds = config.get<number>(
      'INVITATION_TTL_SECONDS',
      604_800,
    );
  }

  async list(actor: AuthenticatedUser, query: ListUsersQueryDto) {
    const tenantId = this.requireTenant(actor);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      tenantId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.roleId
        ? { roleAssignments: { some: { roleId: query.roleId } } }
        : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: managedUserSelect,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map((user) => this.toResponse(user)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(actor: AuthenticatedUser, userId: string) {
    return this.toResponse(
      await this.findTenantUser(this.requireTenant(actor), userId),
    );
  }

  async invite(actor: AuthenticatedUser, dto: InviteUserDto) {
    const tenantId = this.requireTenant(actor);
    const email = dto.email.trim().toLowerCase();
    const [tenant, existingUser, roles, pendingInvitations] = await Promise.all(
      [
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true },
        }),
        this.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        }),
        this.prisma.role.findMany({
          where: { tenantId, id: { in: dto.roleIds } },
          select: {
            id: true,
            name: true,
            rank: true,
            systemRole: true,
          },
        }),
        this.prisma.userInvitation.findMany({
          where: {
            tenantId,
            email,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: {
            roles: {
              select: { role: { select: { rank: true } } },
            },
          },
        }),
      ],
    );
    if (!tenant) {
      throw new NotFoundException('Entreprise introuvable');
    }
    if (existingUser) {
      throw new ConflictException(
        'Un compte existe déjà avec cette adresse e-mail',
      );
    }
    this.assertExactRoleSet(dto.roleIds, roles);
    this.assertRolesAssignable(actor, roles);
    for (const invitation of pendingInvitations) {
      this.assertRolesAssignable(
        actor,
        invitation.roles.map(({ role }) => role),
      );
    }

    const rawToken = this.tokens.createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.invitationTtlSeconds * 1000);
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.userInvitation.updateMany({
        where: {
          tenantId,
          email,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      const created = await tx.userInvitation.create({
        data: {
          tenantId,
          invitedById: actor.id,
          email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          tokenHash: this.tokens.hashToken(rawToken),
          expiresAt,
          roles: {
            create: roles.map((role) => ({ roleId: role.id })),
          },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          expiresAt: true,
          createdAt: true,
          roles: {
            select: {
              role: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'user.invited',
        targetType: 'user_invitation',
        targetId: created.id,
        metadata: { email, roleIds: dto.roleIds },
      });
      return created;
    });

    await this.mailer.sendUserInvitation({
      email,
      firstName: dto.firstName,
      tenantName: tenant.name,
      inviterName: `${actor.firstName} ${actor.lastName}`,
      token: rawToken,
    });

    return {
      ...invitation,
      roles: invitation.roles.map(({ role }) => role),
    };
  }

  async listInvitations(actor: AuthenticatedUser) {
    const tenantId = this.requireTenant(actor);
    const restrictedRoleFilter =
      actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN
        ? {}
        : {
            roles: {
              every: {
                role: { rank: { lt: this.actorMaxRank(actor) } },
              },
            },
          };
    const invitations = await this.prisma.userInvitation.findMany({
      where: { tenantId, ...restrictedRoleFilter },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        invitedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        roles: {
          select: {
            role: { select: { id: true, name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((invitation) => ({
      ...invitation,
      roles: invitation.roles.map(({ role }) => role),
      status: this.invitationStatus(invitation),
    }));
  }

  async revokeInvitation(
    actor: AuthenticatedUser,
    invitationId: string,
  ): Promise<void> {
    const tenantId = this.requireTenant(actor);
    await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.userInvitation.findFirst({
        where: { id: invitationId, tenantId },
        select: {
          id: true,
          acceptedAt: true,
          revokedAt: true,
          roles: {
            select: { role: { select: { rank: true } } },
          },
        },
      });
      if (!invitation) {
        throw new NotFoundException('Invitation introuvable');
      }
      if (invitation.acceptedAt || invitation.revokedAt) {
        throw new ConflictException('Cette invitation n’est plus révocable');
      }
      this.assertRolesAssignable(
        actor,
        invitation.roles.map(({ role }) => role),
      );
      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'user.invitation-revoked',
        targetType: 'user_invitation',
        targetId: invitation.id,
      });
    });
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const tokenHash = this.tokens.hashToken(dto.token);
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { tokenHash },
      include: {
        roles: { include: { role: true } },
      },
    });
    const now = new Date();
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now
    ) {
      throw new UnauthorizedException(
        'Invitation invalide, expirée ou déjà utilisée',
      );
    }
    if (
      invitation.roles.length === 0 ||
      invitation.roles.some(({ role }) => role.tenantId !== invitation.tenantId)
    ) {
      throw new ConflictException(
        'Les rôles de cette invitation ne sont plus valides',
      );
    }

    const passwordHash = await this.passwords.hash(dto.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.userInvitation.updateMany({
          where: {
            id: invitation.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { acceptedAt: now },
        });
        if (claimed.count !== 1) {
          throw new UnauthorizedException(
            'Invitation invalide, expirée ou déjà utilisée',
          );
        }

        const created = await tx.user.create({
          data: {
            email: invitation.email,
            firstName: invitation.firstName,
            lastName: invitation.lastName,
            passwordHash,
            tenantId: invitation.tenantId,
            emailVerifiedAt: now,
            role: this.baseRole(invitation.roles.map(({ role }) => role)),
            roleAssignments: {
              create: invitation.roles.map(({ role }) => ({
                roleId: role.id,
                assignedById: invitation.invitedById,
              })),
            },
          },
          select: managedUserSelect,
        });
        await this.audit.write(tx, {
          tenantId: invitation.tenantId,
          actorUserId: created.id,
          action: 'user.invitation-accepted',
          targetType: 'user',
          targetId: created.id,
          metadata: { invitationId: invitation.id },
        });
        return created;
      });
      return this.toResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Un compte existe déjà avec cette adresse e-mail',
        );
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedUser, userId: string, dto: UpdateUserDto) {
    const tenantId = this.requireTenant(actor);
    const target = await this.findTenantUser(tenantId, userId);
    this.assertCanManageTarget(actor, target);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: dto,
        select: managedUserSelect,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'user.updated',
        targetType: 'user',
        targetId: target.id,
        metadata: { fields: Object.keys(dto) },
      });
      return this.toResponse(updated);
    });
  }

  async changeStatus(
    actor: AuthenticatedUser,
    userId: string,
    dto: UpdateUserStatusDto,
  ) {
    const tenantId = this.requireTenant(actor);
    const target = await this.findTenantUser(tenantId, userId);
    if (target.id === actor.id && !dto.isActive) {
      throw new ForbiddenException(
        'Vous ne pouvez pas désactiver votre propre compte',
      );
    }
    this.assertCanManageTarget(actor, target);
    if (!dto.isActive) {
      await this.assertNotLastAdmin(tenantId, target);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { isActive: dto.isActive },
        select: managedUserSelect,
      });
      if (!dto.isActive) {
        await this.revokeAllSessions(
          tx,
          target.id,
          'account_deactivated_by_admin',
        );
      }
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: dto.isActive ? 'user.activated' : 'user.deactivated',
        targetType: 'user',
        targetId: target.id,
      });
      return this.toResponse(updated);
    });
  }

  async assignRoles(
    actor: AuthenticatedUser,
    userId: string,
    dto: AssignUserRolesDto,
  ) {
    const tenantId = this.requireTenant(actor);
    if (actor.id === userId) {
      throw new ForbiddenException(
        'Vous ne pouvez pas modifier vos propres rôles',
      );
    }
    const [target, roles] = await Promise.all([
      this.findTenantUser(tenantId, userId),
      this.prisma.role.findMany({
        where: { tenantId, id: { in: dto.roleIds } },
        select: {
          id: true,
          name: true,
          slug: true,
          rank: true,
          systemRole: true,
          isSystem: true,
        },
      }),
    ]);
    this.assertCanManageTarget(actor, target);
    this.assertExactRoleSet(dto.roleIds, roles);
    this.assertRolesAssignable(actor, roles);
    const baseRole = this.baseRole(roles);
    if (target.role === UserRole.ADMIN && baseRole !== UserRole.ADMIN) {
      await this.assertNotLastAdmin(tenantId, target);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.deleteMany({
        where: { userId: target.id },
      });
      await tx.userRoleAssignment.createMany({
        data: roles.map((role) => ({
          userId: target.id,
          roleId: role.id,
          assignedById: actor.id,
        })),
      });
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { role: baseRole },
        select: managedUserSelect,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'user.roles-assigned',
        targetType: 'user',
        targetId: target.id,
        metadata: { roleIds: dto.roleIds },
      });
      return this.toResponse(updated);
    });
  }

  async revokeSessions(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<void> {
    const tenantId = this.requireTenant(actor);
    const target = await this.findTenantUser(tenantId, userId);
    this.assertCanManageTarget(actor, target);
    await this.prisma.$transaction(async (tx) => {
      await this.revokeAllSessions(tx, target.id, 'sessions_revoked_by_admin');
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'user.sessions-revoked',
        targetType: 'user',
        targetId: target.id,
      });
    });
  }

  private async findTenantUser(
    tenantId: string,
    userId: string,
  ): Promise<ManagedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: managedUserSelect,
    });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    return user;
  }

  private assertCanManageTarget(
    actor: AuthenticatedUser,
    target: ManagedUser,
  ): void {
    if (actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN) {
      return;
    }
    const actorRank = this.actorMaxRank(actor);
    const targetRank = Math.max(
      0,
      ...target.roleAssignments.map(({ role }) => role.rank),
    );
    if (targetRank >= actorRank) {
      throw new ForbiddenException(
        'Vous ne pouvez pas administrer un utilisateur de niveau égal ou supérieur',
      );
    }
  }

  private assertRolesAssignable(
    actor: AuthenticatedUser,
    roles: ReadonlyArray<{ rank: number }>,
  ): void {
    if (actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN) {
      return;
    }
    const actorRank = this.actorMaxRank(actor);
    if (roles.some((role) => role.rank >= actorRank)) {
      throw new ForbiddenException(
        'Vous ne pouvez pas attribuer un rôle de niveau égal ou supérieur au vôtre',
      );
    }
  }

  private assertExactRoleSet(
    requestedIds: readonly string[],
    roles: ReadonlyArray<{ id: string }>,
  ): void {
    if (new Set(requestedIds).size !== roles.length) {
      throw new BadRequestException(
        'Un ou plusieurs rôles sont invalides pour ce tenant',
      );
    }
  }

  private async assertNotLastAdmin(
    tenantId: string,
    target: ManagedUser,
  ): Promise<void> {
    if (target.role !== UserRole.ADMIN || !target.isActive) {
      return;
    }
    const activeAdmins = await this.prisma.user.count({
      where: { tenantId, role: UserRole.ADMIN, isActive: true },
    });
    if (activeAdmins <= 1) {
      throw new ConflictException(
        'Le tenant doit conserver au moins un administrateur actif',
      );
    }
  }

  private async revokeAllSessions(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await tx.refreshToken.updateMany({
      where: { session: { userId }, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private baseRole(
    roles: ReadonlyArray<{ systemRole: UserRole | null; rank: number }>,
  ): UserRole {
    return (
      [...roles]
        .filter(
          (role): role is { systemRole: UserRole; rank: number } =>
            role.systemRole !== null,
        )
        .sort((a, b) => b.rank - a.rank)[0]?.systemRole ?? UserRole.USER
    );
  }

  private actorMaxRank(actor: AuthenticatedUser): number {
    return Math.max(0, ...actor.roles.map((role) => role.rank));
  }

  private requireTenant(actor: AuthenticatedUser): string {
    if (!actor.tenantId) {
      throw new ForbiddenException('Un contexte tenant est requis');
    }
    return actor.tenantId;
  }

  private toResponse(user: ManagedUser) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      baseRole: user.role,
      isActive: user.isActive,
      emailVerified: Boolean(user.emailVerifiedAt),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.roleAssignments.map(({ role }) => role),
    };
  }

  private invitationStatus(invitation: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  }): 'accepted' | 'revoked' | 'expired' | 'pending' {
    if (invitation.acceptedAt) return 'accepted';
    if (invitation.revokedAt) return 'revoked';
    if (invitation.expiresAt <= new Date()) return 'expired';
    return 'pending';
  }
}
