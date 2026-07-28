/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/auth/authenticated-user.interface';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    role: { findMany: jest.fn() },
    tenant: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const tokens = {
    createOpaqueToken: jest.fn(),
    hashToken: jest.fn(),
  };
  const passwords = { hash: jest.fn() };
  const mailer = { sendUserInvitation: jest.fn() };
  const audit = { write: jest.fn() };
  const actor: AuthenticatedUser = {
    id: 'admin-1',
    email: 'admin@acme.fr',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: UserRole.ADMIN,
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    emailVerified: true,
    roles: [
      {
        id: 'role-admin',
        name: 'Administrateur',
        slug: 'admin',
        rank: 100,
        systemRole: UserRole.ADMIN,
      },
    ],
    permissions: [],
  };
  const target = {
    id: 'user-1',
    email: 'user@acme.fr',
    firstName: 'Grace',
    lastName: 'Hopper',
    role: UserRole.USER,
    isActive: true,
    emailVerifiedAt: new Date(),
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    roleAssignments: [
      {
        role: {
          id: 'role-user',
          name: 'Utilisateur',
          slug: 'user',
          rank: 10,
          systemRole: UserRole.USER,
          isSystem: true,
        },
      },
    ],
  };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prisma as never,
      tokens as never,
      passwords as never,
      mailer as never,
      audit as never,
      new ConfigService({ INVITATION_TTL_SECONDS: 604_800 }),
    );
  });

  it('ajoute toujours le tenant du JWT au filtre de liste', async () => {
    prisma.$transaction.mockResolvedValue([[target], 1]);

    await service.list(actor, {
      page: 1,
      limit: 20,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1' }),
      }),
    );
  });

  it('interdit à un administrateur de se désactiver lui-même', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...target, id: actor.id });

    await expect(
      service.changeStatus(actor, actor.id, { isActive: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejette une affectation contenant un rôle hors tenant', async () => {
    prisma.user.findFirst.mockResolvedValue(target);
    prisma.role.findMany.mockResolvedValue([]);

    await expect(
      service.assignRoles(actor, target.id, {
        roleIds: ['foreign-role'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
