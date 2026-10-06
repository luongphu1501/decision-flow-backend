import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { RolesGuard } from './common/auth/roles.guard';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { RequestsModule } from './modules/requests/requests.module';
import { ActivityModule } from './modules/activity/activity.module';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    HealthModule,
    WorkflowsModule,
    RequestsModule,
    ActivityModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
