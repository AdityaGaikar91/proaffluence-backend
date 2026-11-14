import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

jest.mock('@nestjs/swagger', () => {
  const noop = () => () => undefined;
  return new Proxy({}, { get: () => noop });
});

import {
  ExecuteCalculationRunDto,
  FreezeReportingRunDto,
  OVERRIDE_REASON_MIN_LENGTH,
} from './reports.dto';

type OverrideDto = FreezeReportingRunDto | ExecuteCalculationRunDto;

const errorsFor = async (
  cls: new () => OverrideDto,
  body: Record<string, unknown>,
) => {
  const dto: OverrideDto = plainToInstance(cls, body);
  const errors = await validate(dto);
  return { dto, props: errors.map((e) => e.property) };
};

describe.each([
  ['FreezeReportingRunDto', FreezeReportingRunDto],
  ['ExecuteCalculationRunDto', ExecuteCalculationRunDto],
] as const)('%s override fields', (_name, cls) => {
  const base = { period: '30-09-2026' };

  it('min length is 10', () => {
    expect(OVERRIDE_REASON_MIN_LENGTH).toBe(10);
  });

  it('accepts no override at all', async () => {
    expect((await errorsFor(cls, base)).props).toEqual([]);
  });

  it.each([undefined, '', '   ', 'too short', '   123456789   '])(
    'rejects forceOverride with reason %p',
    async (overrideReason) => {
      const { props } = await errorsFor(cls, {
        ...base,
        forceOverride: true,
        overrideReason,
      });
      expect(props).toContain('overrideReason');
    },
  );

  it('trims and accepts a reason of 10+ characters', async () => {
    const { dto, props } = await errorsFor(cls, {
      ...base,
      forceOverride: true,
      overrideReason: '   1234567890   ',
    });
    expect(props).toEqual([]);
    expect(dto.overrideReason).toBe('1234567890');
  });

  it('rejects a reason over 1000 characters', async () => {
    const { props } = await errorsFor(cls, {
      ...base,
      forceOverride: true,
      overrideReason: 'x'.repeat(1001),
    });
    expect(props).toContain('overrideReason');
  });

  it('rejects a non-boolean forceOverride', async () => {
    const { props } = await errorsFor(cls, {
      ...base,
      forceOverride: 'yes',
      overrideReason: '1234567890',
    });
    expect(props).toContain('forceOverride');
  });
});
