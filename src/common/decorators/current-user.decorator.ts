import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { RequestWithUser } from '../auth/request-with-user.interface';

export const CurrentUser = createParamDecorator(
  (
    field: keyof AuthenticatedUser | undefined,
    context: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[keyof AuthenticatedUser] => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return field ? request.user[field] : request.user;
  },
);
