import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async demoLogin(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        reviewerRole: true,
        avatarUrl: true,
      },
    });
    if (!user) {
      throw new ApiException(
        'DEMO_ACCOUNT_NOT_FOUND',
        'Demo account has not been seeded.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, role: user.role }),
      tokenType: 'Bearer',
      expiresIn: this.config.get<number>('JWT_EXPIRES_IN_SECONDS', 7200),
      user,
    };
  }
}
