import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check application and database health' })
  async check(): Promise<{ status: string; database: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database health check failed.',
      });
    }
  }
}
