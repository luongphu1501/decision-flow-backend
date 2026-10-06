import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { DemoLoginDto } from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('demo-login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in as a seeded demo account' })
  login(@Body() dto: DemoLoginDto) {
    return this.service.demoLogin(dto.email);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated demo profile' })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
