import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthUser } from './auth-user';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ApiException } from '../errors/api.exception';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !required.includes(user.role)) {
      throw new ApiException(
        'PERMISSION_DENIED',
        'You do not have permission for this action.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
