import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestWithUser } from '../auth/request-with-user.interface';
import { VERIFIED_EMAIL_KEY } from '../decorators/verified-email.decorator';

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isRequired = this.reflector.getAllAndOverride<boolean>(
      VERIFIED_EMAIL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isRequired) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user?.emailVerified) {
      throw new ForbiddenException(
        'Validez votre adresse e-mail pour continuer',
      );
    }
    return true;
  }
}
