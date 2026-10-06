import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request & { requestId?: string }, response: Response, next: NextFunction): void {
    const incoming = request.header('x-request-id');
    request.requestId = incoming?.slice(0, 100) || `api_req_${randomUUID()}`;
    response.setHeader('x-request-id', request.requestId);
    const started = performance.now();
    response.on('finish', () => {
      this.logger.log(
        JSON.stringify({
          requestId: request.requestId,
          method: request.method,
          route: request.originalUrl.split('?')[0],
          status: response.statusCode,
          durationMs: Math.round(performance.now() - started),
        }),
      );
    });
    next();
  }
}
