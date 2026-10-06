import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../auth/auth-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);
