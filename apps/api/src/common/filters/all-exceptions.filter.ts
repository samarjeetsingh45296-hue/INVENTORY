import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextStore } from '../context/request-context';

/**
 * Turns anything thrown into a consistent JSON error, and keeps database
 * internals out of API responses while still logging them server-side.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    const requestId = RequestContextStore.get().requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. The team has been notified.';
    let error = 'InternalServerError';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      error = exception.name;
      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as Record<string, unknown>;
        message = (b.message as string) ?? message;
        details = b.details ?? (Array.isArray(b.message) ? b.message : undefined);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message, error } = mapPrismaError(exception));
    } else if (exception instanceof Error) {
      // The soft-delete extension throws plain Errors for refused hard deletes.
      if (exception.message.includes('Hard delete') ||
          exception.message.includes('append-only')) {
        status = HttpStatus.FORBIDDEN;
        error = 'ProtectedRecord';
        message = exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${req.method} ${req.url} -> ${status}: ${
          (exception as Error)?.message
        }`,
        (exception as Error)?.stack,
      );
    }

    res.status(status).json({ statusCode: status, error, message, requestId, details });
  }
}

function mapPrismaError(e: Prisma.PrismaClientKnownRequestError): {
  status: number;
  message: string;
  error: string;
} {
  const target = (e.meta?.target as string[] | undefined)?.join(', ');
  switch (e.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        error: 'DuplicateRecord',
        message: target
          ? `A record with this ${target} already exists.`
          : 'A record with these details already exists.',
      };
    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        error: 'InUse',
        message:
          'This record is referenced elsewhere and cannot be changed or removed. ' +
          'Archive it instead so the history stays intact.',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        error: 'NotFound',
        message: 'That record does not exist, or has been archived.',
      };
    default:
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'DatabaseError',
        message: 'The request could not be completed.',
      };
  }
}
