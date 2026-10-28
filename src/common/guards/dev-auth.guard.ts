import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Development authentication guard.
 *
 * ⚠️ WARNING: This is a DEVELOPMENT-ONLY auth guard for standalone testing.
 * In production, replace with a real JWT/session-based authentication system
 * that validates tokens against the university ERP's identity provider.
 *
 * Usage: Pass an Authorization header with "Bearer <studentId>"
 * Example: Authorization: Bearer STU-001
 *
 * The studentId is extracted and placed on request.user.studentId
 * for downstream services to use.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is required');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Authorization header must be in format: Bearer <studentId>');
    }

    const studentId = parts[1];
    if (!studentId || studentId.trim().length === 0) {
      throw new UnauthorizedException('Student ID cannot be empty');
    }

    // Attach student identity to request for downstream use
    (request as any).user = { studentId: studentId.trim() };
    return true;
  }
}
