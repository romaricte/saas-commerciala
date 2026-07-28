import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenType, Prisma, TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '@prisma/prisma.service';
import { provisionTenantRbac } from '@common/auth/rbac-provisioning';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { AuthMailService } from './auth-mail.service';
import { AuthTokenService } from './auth-token.service';
import {
  AuthResult,
  PublicUser,
  RequestMetadata,
  SessionResponse,
} from './auth.types';
import { PasswordService } from './password.service';

type UserForAuth = {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  lockedUntil: Date | null;
  failedLoginCount: number;
  tenant: { status: TenantStatus } | null;
};

@Injectable()
export class AuthService {
  private readonly maxLoginAttempts: number;
  private readonly lockoutSeconds: number;
  private readonly emailVerificationTtlSeconds: number;
  private readonly passwordResetTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: AuthTokenService,
    private readonly mailer: AuthMailService,
    config: ConfigService,
  ) {
    this.maxLoginAttempts = config.get<number>('AUTH_MAX_LOGIN_ATTEMPTS', 5);
    this.lockoutSeconds = config.get<number>('AUTH_LOCKOUT_SECONDS', 900);
    this.emailVerificationTtlSeconds = config.get<number>(
      'EMAIL_VERIFICATION_TTL_SECONDS',
      86_400,
    );
    this.passwordResetTtlSeconds = config.get<number>(
      'PASSWORD_RESET_TTL_SECONDS',
      1_800,
    );
  }

  async register(
    dto: RegisterDto,
    metadata: RequestMetadata,
  ): Promise<AuthResult> {
    const email = this.normalizeEmail(dto.email);
    const passwordHash = await this.passwords.hash(dto.password);
    const verificationToken = this.tokens.createOpaqueToken();
    const verificationHash = this.tokens.hashToken(verificationToken);
    const slug = await this.availableTenantSlug(
      dto.companySlug ?? dto.companyName,
    );

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: dto.companyName,
            slug,
          },
        });
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: UserRole.ADMIN,
            tenantId: tenant.id,
          },
        });
        await provisionTenantRbac(tx, tenant.id, user.id);

        await tx.authToken.create({
          data: {
            userId: user.id,
            type: AuthTokenType.EMAIL_VERIFICATION,
            tokenHash: verificationHash,
            expiresAt: this.afterSeconds(this.emailVerificationTtlSeconds),
          },
        });

        return this.createSession(
          tx,
          { ...user, tenant: { status: tenant.status } },
          metadata,
        );
      });

      await this.mailer.sendEmailVerification(
        email,
        dto.firstName,
        verificationToken,
      );
      return result;
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

  async login(dto: LoginDto, metadata: RequestMetadata): Promise<AuthResult> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: { select: { status: true } } },
    });

    if (!user) {
      await this.passwords.verifyDummy(dto.password);
      throw this.invalidCredentials();
    }

    const passwordIsValid = await this.passwords.verify(
      user.passwordHash,
      dto.password,
    );
    if (!passwordIsValid) {
      await this.recordFailedLogin(user.id);
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw this.invalidCredentials();
    }
    this.assertUserCanAuthenticate(user);

    return this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
        include: { tenant: { select: { status: true } } },
      });
      return this.createSession(tx, updatedUser, metadata);
    });
  }

  async refresh(rawToken: string): Promise<AuthResult> {
    const payload = await this.tokens.verifyRefreshToken(rawToken);
    const tokenHash = this.tokens.hashToken(rawToken);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const storedToken = await tx.refreshToken.findUnique({
        where: { id: payload.jti },
        include: {
          session: {
            include: {
              user: {
                include: { tenant: { select: { status: true } } },
              },
            },
          },
        },
      });

      if (
        !storedToken ||
        storedToken.tokenHash !== tokenHash ||
        storedToken.sessionId !== payload.sid ||
        storedToken.session.userId !== payload.sub
      ) {
        return { kind: 'invalid' as const };
      }

      if (storedToken.usedAt || storedToken.revokedAt) {
        await this.revokeSessionFamily(
          tx,
          storedToken.sessionId,
          'refresh_token_reuse',
        );
        return { kind: 'reuse' as const };
      }

      const now = new Date();
      const { session } = storedToken;
      if (
        session.revokedAt ||
        session.expiresAt <= now ||
        storedToken.expiresAt <= now
      ) {
        return { kind: 'invalid' as const };
      }

      this.assertUserCanAuthenticate(session.user);

      // Cette écriture conditionnelle est le verrou de concurrence : deux
      // refresh simultanés ne peuvent pas consommer le même token.
      const claimed = await tx.refreshToken.updateMany({
        where: {
          id: storedToken.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        await this.revokeSessionFamily(
          tx,
          session.id,
          'concurrent_refresh_reuse',
        );
        return { kind: 'reuse' as const };
      }

      const remainingSeconds = Math.floor(
        (session.expiresAt.getTime() - now.getTime()) / 1000,
      );
      const newRefresh = await this.tokens.signRefreshToken({
        userId: session.user.id,
        sessionId: session.id,
        expiresInSeconds: remainingSeconds,
      });
      await tx.refreshToken.create({
        data: {
          id: newRefresh.tokenId,
          tokenHash: this.tokens.hashToken(newRefresh.token),
          sessionId: session.id,
          expiresAt: newRefresh.expiresAt,
        },
      });
      await tx.authSession.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });

      const accessToken = await this.tokens.signAccessToken({
        sub: session.user.id,
        sid: session.id,
        email: session.user.email,
        role: session.user.role,
        tenantId: session.user.tenantId,
      });

      return {
        kind: 'success' as const,
        result: {
          response: {
            accessToken,
            accessTokenExpiresIn: this.tokens.accessTtlSeconds,
            user: this.toPublicUser(session.user),
          },
          refreshToken: newRefresh.token,
          refreshTokenExpiresAt: newRefresh.expiresAt,
        },
      };
    });

    if (outcome.kind !== 'success') {
      throw new UnauthorizedException('Session expirée ou invalide');
    }
    return outcome.result;
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: { id: sessionId, userId },
        select: { id: true },
      });
      if (session) {
        await this.revokeSessionFamily(tx, session.id, 'user_logout');
      }
    });
  }

  async logoutAll(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'user_logout_all' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { session: { userId }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.toPublicUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (
      !user ||
      !(await this.passwords.verify(user.passwordHash, dto.currentPassword))
    ) {
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }
    if (await this.passwords.verify(user.passwordHash, dto.newPassword)) {
      throw new ConflictException(
        'Le nouveau mot de passe doit être différent de l’ancien',
      );
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password_changed' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { session: { userId }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  async forgotPassword(emailInput: string): Promise<void> {
    const email = this.normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, isActive: true },
    });

    // La réponse HTTP reste identique que le compte existe ou non.
    if (!user?.isActive) {
      this.tokens.hashToken(this.tokens.createOpaqueToken());
      return;
    }

    const rawToken = this.tokens.createOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.authToken.deleteMany({
        where: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          usedAt: null,
        },
      }),
      this.prisma.authToken.create({
        data: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          tokenHash: this.tokens.hashToken(rawToken),
          expiresAt: this.afterSeconds(this.passwordResetTtlSeconds),
        },
      }),
    ]);
    await this.mailer.sendPasswordReset(user.email, user.firstName, rawToken);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.tokens.hashToken(dto.token);
    const storedToken = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, passwordHash: true } } },
    });
    if (
      !storedToken ||
      storedToken.type !== AuthTokenType.PASSWORD_RESET ||
      storedToken.usedAt ||
      storedToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(
        'Jeton de réinitialisation invalide ou expiré',
      );
    }
    if (
      await this.passwords.verify(
        storedToken.user.passwordHash,
        dto.newPassword,
      )
    ) {
      throw new ConflictException(
        'Le nouveau mot de passe doit être différent de l’ancien',
      );
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: {
          id: storedToken.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException(
          'Jeton de réinitialisation invalide ou expiré',
        );
      }
      await tx.user.update({
        where: { id: storedToken.userId },
        data: { passwordHash, passwordChangedAt: now },
      });
      await tx.authSession.updateMany({
        where: { userId: storedToken.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password_reset' },
      });
      await tx.refreshToken.updateMany({
        where: { session: { userId: storedToken.userId }, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = this.tokens.hashToken(rawToken);
    const storedToken = await this.prisma.authToken.findUnique({
      where: { tokenHash },
    });
    const now = new Date();
    if (
      !storedToken ||
      storedToken.type !== AuthTokenType.EMAIL_VERIFICATION ||
      storedToken.usedAt ||
      storedToken.expiresAt <= now
    ) {
      throw new UnauthorizedException(
        'Jeton de vérification invalide ou expiré',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: {
          id: storedToken.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException(
          'Jeton de vérification invalide ou expiré',
        );
      }
      await tx.user.update({
        where: { id: storedToken.userId },
        data: { emailVerifiedAt: now },
      });
    });
  }

  async resendVerification(emailInput: string): Promise<void> {
    const email = this.normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        emailVerifiedAt: true,
        isActive: true,
      },
    });
    if (!user?.isActive || user.emailVerifiedAt) {
      return;
    }

    const rawToken = this.tokens.createOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.authToken.deleteMany({
        where: {
          userId: user.id,
          type: AuthTokenType.EMAIL_VERIFICATION,
          usedAt: null,
        },
      }),
      this.prisma.authToken.create({
        data: {
          userId: user.id,
          type: AuthTokenType.EMAIL_VERIFICATION,
          tokenHash: this.tokens.hashToken(rawToken),
          expiresAt: this.afterSeconds(this.emailVerificationTtlSeconds),
        },
      }),
    ]);
    await this.mailer.sendEmailVerification(
      user.email,
      user.firstName,
      rawToken,
    );
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionResponse[]> {
    const sessions = await this.prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      current: session.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    await this.prisma.$transaction((tx) =>
      this.revokeSessionFamily(tx, session.id, 'user_revoked_device'),
    );
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    user: UserForAuth,
    metadata: RequestMetadata,
  ): Promise<AuthResult> {
    const sessionExpiresAt = this.afterSeconds(this.tokens.refreshTtlSeconds);
    const session = await tx.authSession.create({
      data: {
        userId: user.id,
        userAgent: metadata.userAgent?.slice(0, 512),
        ipAddress: metadata.ipAddress?.slice(0, 64),
        expiresAt: sessionExpiresAt,
      },
    });
    const refresh = await this.tokens.signRefreshToken({
      userId: user.id,
      sessionId: session.id,
    });
    await tx.refreshToken.create({
      data: {
        id: refresh.tokenId,
        tokenHash: this.tokens.hashToken(refresh.token),
        sessionId: session.id,
        expiresAt: refresh.expiresAt,
      },
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });

    return {
      response: {
        accessToken,
        accessTokenExpiresIn: this.tokens.accessTtlSeconds,
        user: this.toPublicUser(user),
      },
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= this.maxLoginAttempts) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil: this.afterSeconds(this.lockoutSeconds),
        },
      });
    }
  }

  private assertUserCanAuthenticate(user: UserForAuth): void {
    if (!user.isActive) {
      throw new ForbiddenException('Ce compte est désactivé');
    }
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      (!user.tenant ||
        (user.tenant.status !== TenantStatus.ACTIVE &&
          user.tenant.status !== TenantStatus.TRIAL))
    ) {
      throw new ForbiddenException('L’accès à cette entreprise est suspendu');
    }
  }

  private async revokeSessionFamily(
    tx: Prisma.TransactionClient,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    await tx.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await tx.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    tenantId: string | null;
    emailVerifiedAt: Date | null;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tenantId: user.tenantId,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('E-mail ou mot de passe incorrect');
  }

  private afterSeconds(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }

  private async availableTenantSlug(input: string): Promise<string> {
    const base =
      input
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 70) || 'entreprise';

    let candidate = base;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.prisma.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
      candidate = `${base}-${Math.random().toString(36).slice(2, 8)}`;
    }
    throw new ConflictException(
      'Impossible de générer un identifiant d’entreprise unique',
    );
  }
}
