import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Extracts the authenticated student ID from the request.
 * The student identity is set by the auth guard (DevAuthGuard or production equivalent).
 *
 * Usage in controller:
 *   @Get()
 *   getPayment(@CurrentStudent() studentId: string) { ... }
 */
export const CurrentStudent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = (request as any).user;
    if (!user || !user.studentId) {
      throw new Error('CurrentStudent decorator requires an auth guard that sets request.user');
    }
    return user.studentId;
  },
);
