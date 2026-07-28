import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { AuthTokenService } from './auth-token.service';

describe('AuthTokenService', () => {
  let service: AuthTokenService;

  beforeEach(() => {
    service = new AuthTokenService(
      new JwtService(),
      new ConfigService({
        JWT_ACCESS_SECRET: 'a'.repeat(64),
        JWT_REFRESH_SECRET: 'b'.repeat(64),
        AUTH_TOKEN_PEPPER: 'c'.repeat(64),
        JWT_ACCESS_TTL_SECONDS: 900,
        JWT_REFRESH_TTL_SECONDS: 3600,
      }),
    );
  });

  it('signe et vérifie un access token typé', async () => {
    const token = await service.signAccessToken({
      sub: 'user-1',
      sid: 'session-1',
      email: 'ada@acme.fr',
      role: UserRole.ADMIN,
      tenantId: 'tenant-1',
    });

    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      type: 'access',
    });
  });

  it('empêche un refresh token d’être utilisé comme access token', async () => {
    const { token } = await service.signRefreshToken({
      userId: 'user-1',
      sessionId: 'session-1',
    });

    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('produit une empreinte stable sans stocker le jeton brut', () => {
    const raw = service.createOpaqueToken();
    expect(service.hashToken(raw)).toHaveLength(64);
    expect(service.hashToken(raw)).toBe(service.hashToken(raw));
    expect(service.hashToken(raw)).not.toContain(raw);
  });
});
