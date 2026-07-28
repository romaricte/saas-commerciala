import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PermissionKey } from '../auth/permission.constants';
import { RequestWithUser } from '../auth/request-with-user.interface';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (user?.role === UserRole.SUPER_ADMIN) {
      return true;
    }
    if (
      !user ||
      !required.every((permission) => user.permissions.includes(permission))
    ) {
      throw new ForbiddenException(
        'Vous ne disposez pas des permissions requises',
      );
    }
    return true;
  }
}
