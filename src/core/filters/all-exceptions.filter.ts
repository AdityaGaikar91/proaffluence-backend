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

    const error = exception as Error & { type?: string; status?: number; statusCode?: number };
    const bodyLimit = process.env.BODY_JSON_LIMIT || '35mb';
    const isPayloadTooLarge =
      error?.name === 'PayloadTooLargeError' ||
      error?.type === 'entity.too.large' ||
      /request entity too large/i.test(error?.message || '');

    if (isPayloadTooLarge) {
      this.logger.warn(
        `Payload too large on ${request.method} ${request.url} (limit ${bodyLimit})`,
      );
      return response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `Upload too large. Max body size is ${bodyLimit} (use a smaller PDF or multipart file upload).`,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    // Unhandled / Internal Server Errors (e.g. Prisma or database runtime exceptions)
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
