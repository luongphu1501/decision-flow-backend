import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'development-only-secret-change-me-32'),
    });
  }

  async validate(payload: { sub: string }): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, reviewerRole: true },
    });
  }
}
