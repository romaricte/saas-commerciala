import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PERMISSIONS } from '../auth/permission.constants';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const request = {
    user: {
      role: UserRole.USER,
      permissions: [] as string[],
    },
  };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  let guard: PermissionsGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    request.user.role = UserRole.USER;
    request.user.permissions = [];
    guard = new PermissionsGuard(reflector as unknown as Reflector);
  });

  it('laisse passer une route sans permission déclarée', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('exige toutes les permissions déclarées', () => {
    reflector.getAllAndOverride.mockReturnValue([
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_UPDATE,
    ]);
    request.user.permissions = [PERMISSIONS.USERS_READ];

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('accorde le bypass plateforme au SUPER_ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.ROLES_DELETE]);
    request.user.role = UserRole.SUPER_ADMIN;

    expect(guard.canActivate(context)).toBe(true);
  });
});
