import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@prisma/prisma.service';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { AuditService } from '@modules/users/audit.service';
import {
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/roles.dto';

const roleDetailsSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  rank: true,
  isSystem: true,
  systemRole: true,
  createdAt: true,
  updatedAt: true,
  permissions: {
    select: {
      permission: {
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          resource: true,
          action: true,
        },
      },
    },
  },
  _count: {
    select: {
      users: true,
      invitationRoles: true,
    },
  },
} satisfies Prisma.RoleSelect;

type RoleDetails = Prisma.RoleGetPayload<{
  select: typeof roleDetailsSelect;
}>;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser) {
    const tenantId = this.requireTenant(actor);
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      select: roleDetailsSelect,
      orderBy: [{ rank: 'desc' }, { name: 'asc' }],
    });
    return roles.map((role) => this.toResponse(role));
  }

  async findOne(actor: AuthenticatedUser, roleId: string) {
    return this.toResponse(
      await this.findTenantRole(this.requireTenant(actor), roleId),
    );
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        resource: true,
        action: true,
      },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateRoleDto) {
    const tenantId = this.requireTenant(actor);
    this.assertRankAllowed(actor, dto.rank);
    const permissions = await this.resolvePermissions(
      actor,
      dto.permissionKeys,
    );
    const slug = dto.slug ?? this.slugify(dto.name);

    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.role.create({
          data: {
            tenantId,
            name: dto.name,
            slug,
            description: dto.description,
            rank: dto.rank,
            permissions: {
              create: permissions.map((permission) => ({
                permissionId: permission.id,
              })),
            },
          },
          select: roleDetailsSelect,
        });
        await this.audit.write(tx, {
          tenantId,
          actorUserId: actor.id,
          action: 'role.created',
          targetType: 'role',
          targetId: created.id,
          metadata: {
            name: created.name,
            rank: created.rank,
            permissionKeys: dto.permissionKeys,
          },
        });
        return created;
      });
      return this.toResponse(role);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Un rôle utilise déjà ce nom technique dans le tenant',
        );
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedUser, roleId: string, dto: UpdateRoleDto) {
    const tenantId = this.requireTenant(actor);
    const role = await this.findTenantRole(tenantId, roleId);
    this.assertMutableRole(actor, role);
    if (dto.rank !== undefined) {
      this.assertRankAllowed(actor, dto.rank);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.role.update({
        where: { id: role.id },
        data: dto,
        select: roleDetailsSelect,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'role.updated',
        targetType: 'role',
        targetId: role.id,
        metadata: { fields: Object.keys(dto) },
      });
      return result;
    });
    return this.toResponse(updated);
  }

  async setPermissions(
    actor: AuthenticatedUser,
    roleId: string,
    dto: SetRolePermissionsDto,
  ) {
    const tenantId = this.requireTenant(actor);
    const role = await this.findTenantRole(tenantId, roleId);
    this.assertMutableRole(actor, role);
    const permissions = await this.resolvePermissions(
      actor,
      dto.permissionKeys,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
          })),
        });
      }
      const result = await tx.role.findUniqueOrThrow({
        where: { id: role.id },
        select: roleDetailsSelect,
      });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'role.permissions-updated',
        targetType: 'role',
        targetId: role.id,
        metadata: { permissionKeys: dto.permissionKeys },
      });
      return result;
    });
    return this.toResponse(updated);
  }

  async remove(actor: AuthenticatedUser, roleId: string): Promise<void> {
    const tenantId = this.requireTenant(actor);
    const role = await this.findTenantRole(tenantId, roleId);
    this.assertMutableRole(actor, role);
    const pendingInvitations = await this.prisma.invitationRole.count({
      where: {
        roleId: role.id,
        invitation: {
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      },
    });
    if (role._count.users > 0 || pendingInvitations > 0) {
      throw new ConflictException(
        'Ce rôle est encore affecté à des utilisateurs ou invitations',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: role.id } });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.id,
        action: 'role.deleted',
        targetType: 'role',
        targetId: role.id,
        metadata: { name: role.name },
      });
    });
  }

  private async resolvePermissions(
    actor: AuthenticatedUser,
    requestedKeys: readonly string[],
  ) {
    const uniqueKeys = [...new Set(requestedKeys)];
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: uniqueKeys } },
      select: { id: true, key: true },
    });
    if (permissions.length !== uniqueKeys.length) {
      throw new BadRequestException(
        'Une ou plusieurs permissions sont inconnues',
      );
    }
    if (
      actor.role !== UserRole.SUPER_ADMIN &&
      uniqueKeys.some((key) => !actor.permissions.includes(key))
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez pas accorder une permission que vous ne possédez pas',
      );
    }
    return permissions;
  }

  private async findTenantRole(
    tenantId: string,
    roleId: string,
  ): Promise<RoleDetails> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId },
      select: roleDetailsSelect,
    });
    if (!role) {
      throw new NotFoundException('Rôle introuvable');
    }
    return role;
  }

  private assertMutableRole(
    actor: AuthenticatedUser,
    role: Pick<RoleDetails, 'isSystem' | 'rank'>,
  ): void {
    if (role.isSystem) {
      throw new ForbiddenException(
        'Les rôles système ne peuvent pas être modifiés',
      );
    }
    this.assertRankAllowed(actor, role.rank);
  }

  private assertRankAllowed(actor: AuthenticatedUser, rank: number): void {
    if (actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN) {
      return;
    }
    const actorRank = Math.max(0, ...actor.roles.map((role) => role.rank));
    if (rank >= actorRank) {
      throw new ForbiddenException(
        'Le niveau du rôle doit être inférieur au vôtre',
      );
    }
  }

  private requireTenant(actor: AuthenticatedUser): string {
    if (!actor.tenantId) {
      throw new ForbiddenException('Un contexte tenant est requis');
    }
    return actor.tenantId;
  }

  private slugify(value: string): string {
    return (
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'role'
    );
  }

  private toResponse(role: RoleDetails) {
    return {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      rank: role.rank,
      isSystem: role.isSystem,
      systemRole: role.systemRole,
      permissions: role.permissions.map(({ permission }) => permission),
      userCount: role._count.users,
      invitationCount: role._count.invitationRoles,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
