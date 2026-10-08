import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { APP_CONTEXT, AppContext } from '../app-context';

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Refund approvals move money, so this route is closed until an admin key is configured. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.ctx.config.ADMIN_API_KEY;
    if (!expected) throw new ServiceUnavailableException('admin API is disabled: set ADMIN_API_KEY');
    const got = context.switchToHttp().getRequest<Request>().header('x-admin-key') ?? '';
    if (!safeEqual(got, expected)) throw new ForbiddenException();
    return true;
  }
}

@Injectable()
export class ChatKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.ctx.config.CHAT_API_KEY;
    if (!expected) return true;
    const got = context.switchToHttp().getRequest<Request>().header('x-api-key') ?? '';
    if (!safeEqual(got, expected)) throw new ForbiddenException();
    return true;
  }
}
