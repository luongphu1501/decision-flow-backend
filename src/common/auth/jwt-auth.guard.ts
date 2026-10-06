import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiException } from '../errors/api.exception';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = any>(err: any, user: any): TUser {
    if (err || !user) {
      throw new ApiException(
        'AUTH_REQUIRED',
        'A valid access token is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return user as TUser;
  }
}
