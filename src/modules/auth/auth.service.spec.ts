/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { TenantStatus, UserRole } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const passwords = {
    hash: jest.fn(),
    verify: jest.fn(),
    verifyDummy: jest.fn(),
  };
  const tokens = {
    accessTtlSeconds: 900,
    refreshTtlSeconds: 2_592_000,
    createOpaqueToken: jest.fn(() => 'opaque-token'),
    hashToken: jest.fn((value: string) => `hash:${value}`),
    verifyRefreshToken: jest.fn(),
    signRefreshToken: jest.fn(),
    signAccessToken: jest.fn(),
  };
  const mailer = {
    sendEmailVerification: jest.fn(),
    sendPasswordReset: jest.fn(),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    tenant: { findUnique: jest.fn() },
    authToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    authSession: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    const config = new ConfigService({
      AUTH_MAX_LOGIN_ATTEMPTS: 5,
      AUTH_LOCKOUT_SECONDS: 900,
      EMAIL_VERIFICATION_TTL_SECONDS: 86_400,
      PASSWORD_RESET_TTL_SECONDS: 1_800,
    });
    service = new AuthService(
      prisma as never,
      passwords as never,
      tokens as never,
      mailer as never,
      config,
    );
  });

  it('neutralise le timing puis renvoie une erreur générique pour un e-mail inconnu', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    passwords.verifyDummy.mockResolvedValue(undefined);

    await expect(
      service.login(
        { email: 'inconnu@example.com', password: 'Secret!123456' },
        {},
      ),
    ).rejects.toMatchObject({
      message: 'E-mail ou mot de passe incorrect',
    });
    expect(passwords.verifyDummy).toHaveBeenCalledWith('Secret!123456');
  });

  it('incrémente le compteur sans révéler qu’un compte existe', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ada@acme.fr',
      passwordHash: 'hash',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: UserRole.ADMIN,
      tenantId: 'tenant-1',
      isActive: true,
      emailVerifiedAt: null,
      lockedUntil: null,
      failedLoginCount: 0,
      tenant: { status: TenantStatus.TRIAL },
    });
    passwords.verify.mockResolvedValue(false);
    prisma.user.update.mockResolvedValue({ failedLoginCount: 1 });

    await expect(
      service.login({ email: 'ada@acme.fr', password: 'Mauvais!12345' }, {}),
    ).rejects.toMatchObject({
      message: 'E-mail ou mot de passe incorrect',
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failedLoginCount: { increment: 1 } },
      }),
    );
  });

  it('révoque toute la session lorsqu’un refresh token consommé est rejoué', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      sid: 'session-1',
      jti: 'token-1',
      type: 'refresh',
    });
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1',
      tokenHash: 'hash:raw-refresh',
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
      revokedAt: null,
      session: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: {
          id: 'user-1',
          email: 'ada@acme.fr',
          passwordHash: 'hash',
          firstName: 'Ada',
          lastName: 'Lovelace',
          role: UserRole.ADMIN,
          tenantId: 'tenant-1',
          isActive: true,
          emailVerifiedAt: new Date(),
          lockedUntil: null,
          failedLoginCount: 0,
          tenant: { status: TenantStatus.ACTIVE },
        },
      },
    });
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );

    await expect(service.refresh('raw-refresh')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revokedReason: 'refresh_token_reuse',
        }),
      }),
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('répond silencieusement à forgot-password pour un compte inconnu', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.forgotPassword('nobody@example.com'),
    ).resolves.toBeUndefined();
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });
});
