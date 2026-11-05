import { ForbiddenException } from '@nestjs/common';
import { ReportingFreezeService } from './reporting-freeze.service';

describe('ReportingFreezeService', () => {
  it('deriveMonthKey from dd-MM-yyyy', () => {
    expect(ReportingFreezeService.deriveMonthKey('30-09-2026')).toBe('2026-09');
  });

  it('deriveMonthKey from YYYY-MM', () => {
    expect(ReportingFreezeService.deriveMonthKey('2026-09')).toBe('2026-09');
  });

  it('assertNotSelfApprove blocks same user', () => {
    const svc = new ReportingFreezeService({} as any);
    expect(() => svc.assertNotSelfApprove('u1', 'u1')).toThrow(
      ForbiddenException,
    );
  });

  it('assertNotSelfApprove allows different user', () => {
    const svc = new ReportingFreezeService({} as any);
    expect(() => svc.assertNotSelfApprove('u1', 'u2')).not.toThrow();
  });
});
