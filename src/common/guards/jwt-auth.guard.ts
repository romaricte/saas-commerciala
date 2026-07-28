import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '@prisma/prisma.service';
import { AuthTokenService } from '@modules/auth/auth-token.service';
import { RequestWithUser } from '../auth/request-with-user.interface';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AuthTokenService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request.headers.authorization);
    const payload = await this.tokens.verifyAccessToken(token);

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            tenant: { select: { status: true } },
            roleAssignments: {
              include: {
                role: {
                  include: {
                    permissions: {
                      include: { permission: { select: { key: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session?.user.isActive) {
      throw new UnauthorizedException('Session invalide ou révoquée');
    }

    const user = session.user;
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      (!user.tenant ||
        (user.tenant.status !== TenantStatus.ACTIVE &&
          user.tenant.status !== TenantStatus.TRIAL))
    ) {
      throw new UnauthorizedException('Session invalide ou révoquée');
    }

    // Un changement/réinitialisation de mot de passe invalide aussi les access
    // tokens encore vivants, même si leur signature reste cryptographiquement valide.
    const issuedAt = payload.iat ?? 0;
    if (Math.floor(user.passwordChangedAt.getTime() / 1000) > issuedAt) {
      throw new UnauthorizedException('Session invalide ou révoquée');
    }

    // La vérification tenant est répétée ici, même si les services d'écriture
    // l'imposent déjà, afin qu'une incohérence de données n'accorde aucun droit.
    const tenantRoles = user.roleAssignments
      .map((assignment) => assignment.role)
      .filter((role) => role.tenantId === user.tenantId);
    const permissions = [
      ...new Set(
        tenantRoles.flatMap((role) =>
          role.permissions.map((assignment) => assignment.permission.key),
        ),
      ),
    ];

    request.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tenantId: user.tenantId,
      sessionId: session.id,
      emailVerified: Boolean(user.emailVerifiedAt),
      roles: tenantRoles.map((role) => ({
        id: role.id,
        name: role.name,
        slug: role.slug,
        rank: role.rank,
        systemRole: role.systemRole,
      })),
      permissions,
    };
    return true;
  }

  private extractBearerToken(authorization?: string): string {
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Bearer token manquant');
    }
    return token;
  }
}
