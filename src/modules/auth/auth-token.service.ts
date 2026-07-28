import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '@common/auth/authenticated-user.interface';

@Injectable()
export class AuthTokenService {
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;

  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly tokenPepper: string;

  constructor(
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    const legacySecret = config.get<string>('JWT_SECRET');
    this.accessSecret =
      config.get<string>('JWT_ACCESS_SECRET') ?? legacySecret ?? '';

    // Les dérivations ne servent qu'à conserver un démarrage local compatible.
    // env.validation impose trois secrets indépendants en production.
    this.refreshSecret =
      config.get<string>('JWT_REFRESH_SECRET') ??
      createHash('sha256').update(`${this.accessSecret}:refresh`).digest('hex');
    this.tokenPepper =
      config.get<string>('AUTH_TOKEN_PEPPER') ??
      createHash('sha256')
        .update(`${this.accessSecret}:opaque-token`)
        .digest('hex');

    this.accessTtlSeconds = config.get<number>('JWT_ACCESS_TTL_SECONDS', 900);
    this.refreshTtlSeconds = config.get<number>(
      'JWT_REFRESH_TTL_SECONDS',
      2_592_000,
    );
  }

  signAccessToken(
    payload: Omit<AccessTokenPayload, 'type' | 'iat' | 'exp'>,
  ): Promise<string> {
    return this.jwtService.signAsync(
      { ...payload, type: 'access' },
      {
        secret: this.accessSecret,
        expiresIn: this.accessTtlSeconds,
      },
    );
  }

  async signRefreshToken(input: {
    userId: string;
    sessionId: string;
    expiresInSeconds?: number;
  }): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
    const tokenId = randomUUID();
    const expiresIn = Math.max(
      1,
      Math.min(
        input.expiresInSeconds ?? this.refreshTtlSeconds,
        this.refreshTtlSeconds,
      ),
    );
    const token = await this.jwtService.signAsync(
      {
        sub: input.userId,
        sid: input.sessionId,
        jti: tokenId,
        type: 'refresh',
      } satisfies RefreshTokenPayload,
      { secret: this.refreshSecret, expiresIn },
    );

    return {
      token,
      tokenId,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: this.accessSecret },
      );
      if (payload.type !== 'access') {
        throw new Error('Invalid token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Jeton d’accès invalide ou expiré');
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        token,
        { secret: this.refreshSecret },
      );
      if (payload.type !== 'refresh' || !payload.jti || !payload.sid) {
        throw new Error('Invalid token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Session expirée ou invalide');
    }
  }

  createOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.tokenPepper).update(token).digest('hex');
  }
}
