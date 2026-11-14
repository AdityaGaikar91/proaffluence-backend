import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// @nestjs/swagger ships ESM that ts-jest cannot load; decorators are no-ops here.
jest.mock('@nestjs/swagger', () => {
  const noop = () => () => undefined;
  return new Proxy({}, { get: () => noop });
});
jest.mock('./pdf-generator.service', () => ({ PdfGeneratorService: class {} }));
jest.mock('./reports.service', () => ({ ReportsService: class {} }));
// better-auth is ESM; the session guard is irrelevant to role metadata.
jest.mock('../auth/guards/auth.guard', () => ({ AuthGuard: class {} }));

import { RolesGuard } from '../auth/guards/roles.guard';
import { ReportsController } from './reports.controller';

/** Staff cannot reach freeze / unfreeze / calculate (and so cannot override). */
describe('ReportsController gate roles', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = ReportsController.prototype as unknown as Record<
    string,
    () => unknown
  >;
  const ctx = (handler: () => unknown, role?: string) =>
    ({
      getHandler: () => handler,
      getClass: () => ReportsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as unknown as ExecutionContext;

  it.each([
    'freezeReportingRun',
    'unfreezeReportingRun',
    'executeCalculationRun',
  ])('%s: manager / super_admin allowed, staff denied', (method) => {
    const handler = proto[method];
    expect(typeof handler).toBe('function');
    expect(guard.canActivate(ctx(handler, 'manager'))).toBe(true);
    expect(guard.canActivate(ctx(handler, 'super_admin'))).toBe(true);
    expect(() => guard.canActivate(ctx(handler, 'staff_entry'))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(ctx(handler, undefined))).toThrow(
      ForbiddenException,
    );
  });
});
