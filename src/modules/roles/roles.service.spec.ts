import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  const prisma = {
    role: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    invitationRole: {
      count: jest.fn(),
    },
    permission: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const manager: AuthenticatedUser = {
    id: 'manager-1',
    email: 'manager@acme.fr',
    firstName: 'Grace',
    lastName: 'Hopper',
    role: UserRole.MANAGER,
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    emailVerified: true,
    roles: [
      {
        id: 'manager-role',
        name: 'Manager',
        slug: 'manager',
        rank: 50,
        systemRole: UserRole.MANAGER,
      },
    ],
    permissions: ['roles.create'],
  };
  const role = {
    id: 'role-1',
    name: 'Commercial',
    slug: 'commercial',
    description: null,
    rank: 20,
    isSystem: false,
    systemRole: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    permissions: [],
    _count: { users: 0, invitationRoles: 0 },
  };

  let service: RolesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.invitationRole.count.mockResolvedValue(0);
    service = new RolesService(prisma as never, audit as never);
  });

  it('interdit toute modification d’un rôle système', async () => {
    prisma.role.findFirst.mockResolvedValue({
      ...role,
      isSystem: true,
      systemRole: UserRole.MANAGER,
    });

    await expect(
      service.update(manager, role.id, { name: 'Nouveau nom' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('interdit d’accorder une permission absente des droits de l’acteur', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { id: 'permission-1', key: 'users.change-status' },
    ]);

    await expect(
      service.create(manager, {
        name: 'Commercial',
        rank: 20,
        permissionKeys: ['users.change-status'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuse de supprimer un rôle encore affecté', async () => {
    prisma.role.findFirst.mockResolvedValue({
      ...role,
      _count: { users: 1, invitationRoles: 0 },
    });

    await expect(service.remove(manager, role.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
