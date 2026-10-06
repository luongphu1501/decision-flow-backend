import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string }>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const validationMessages = Array.isArray(body.message) ? body.message : undefined;
    const defaultCode =
      status === 401
        ? 'AUTH_REQUIRED'
        : status === 403
          ? 'PERMISSION_DENIED'
          : status === 429
            ? 'RATE_LIMITED'
            : status === 400
              ? 'VALIDATION_ERROR'
              : status === 404
                ? 'RESOURCE_NOT_FOUND'
                : 'INTERNAL_ERROR';
    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          requestId: request.requestId,
          method: request.method,
          path: request.originalUrl,
          error: exception instanceof Error ? exception.message : 'Unknown error',
        }),
      );
    }
    response.status(status).json({
      code: typeof body.code === 'string' ? body.code : defaultCode,
      message:
        typeof body.message === 'string'
          ? body.message
          : validationMessages
            ? 'Request validation failed.'
            : status >= 500
              ? 'An unexpected error occurred.'
              : 'Request failed.',
      details:
        typeof body.details === 'object' && body.details !== null
          ? body.details
          : validationMessages
            ? { violations: validationMessages }
            : {},
      requestId: request.requestId ?? 'api_req_unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
