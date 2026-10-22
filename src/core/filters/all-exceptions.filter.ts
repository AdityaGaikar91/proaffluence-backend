import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const isProduction = process.env.NODE_ENV === 'production';

    // Handle standard NestJS HttpExceptions (400, 401, 403, 404, etc.)
    if (isHttpException) {
      const exceptionResponse = exception.getResponse();
      const responsePayload =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? exceptionResponse
          : { statusCode: status, message: exceptionResponse };

      return response.status(status).json(responsePayload);
    }

    // Unhandled / Internal Server Errors (e.g. Prisma or database runtime exceptions)
    const error = exception as Error;
    this.logger.error(
      `Unhandled Exception on ${request.method} ${request.url}: ${error?.message || exception}`,
      error?.stack,
    );

    // Never leak database queries, column names, or raw errors to clients in production
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProduction
        ? 'Internal server error'
        : error?.message || 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
