import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(helmet());
  app.use(json({ limit: '512kb' }));
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DecisionFlow Studio API')
    .setDescription('MVP backend for graph-based approval workflows')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
