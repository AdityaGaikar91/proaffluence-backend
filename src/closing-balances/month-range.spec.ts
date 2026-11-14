import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApprovalStatus } from '@prisma/client';

jest.mock('@nestjs/swagger', () => {
  const noop = () => () => undefined;
  return new Proxy({}, { get: () => noop });
});

import { ClosingBalancesService } from './closing-balances.service';
import { QueryMonthRangeDto } from './dto/query-month-range.dto';

type GroupByArgs = { where: Record<string, unknown> };

function makeService() {
  const groupBy = jest.fn((args: GroupByArgs) => {
    void args;
    return Promise.resolve([
      { monthKey: '2018-03', _count: { _all: 2 } },
      { monthKey: 'bad', _count: { _all: 1 } },
      { monthKey: '2026-09', _count: { _all: 5 } },
    ]);
  });
  const prisma = { closingBalance: { groupBy } };
  const service = new ClosingBalancesService(
    prisma as unknown as ConstructorParameters<
      typeof ClosingBalancesService
    >[0],
    {} as ConstructorParameters<typeof ClosingBalancesService>[1],
  );
  return { service, groupBy };
}

describe('closing-balances month range filters', () => {
  it('lists every non-voided cycle by default', async () => {
    const { service, groupBy } = makeService();
    const res = await service.getMonthRange();
    expect(groupBy.mock.calls[0][0].where).toEqual({ voided: false });
    expect(res.earliestMonthKey).toBe('2018-03');
    expect(res.latestMonthKey).toBe('2026-09');
    expect(res.months).toHaveLength(2);
  });

  it('approvedOnly + groupHeadId restricts to approved rows with an amount', async () => {
    const { service, groupBy } = makeService();
    await service.getMonthRange({ approvedOnly: true, groupHeadId: 'gh-1' });
    expect(groupBy.mock.calls[0][0].where).toEqual({
      voided: false,
      approvalStatus: ApprovalStatus.APPROVED,
      closingAmount: { not: null },
      groupHeadId: 'gh-1',
    });
  });

  it('treats groupHeadId "All" as no Group Head filter', async () => {
    const { service, groupBy } = makeService();
    await service.getMonthRange({ groupHeadId: 'All' });
    expect(groupBy.mock.calls[0][0].where).toEqual({ voided: false });
  });

  it.each([
    [{ approvedOnly: 'true', groupHeadId: ' gh-1 ' }, [], true, 'gh-1'],
    [{ approvedOnly: 'false' }, [], false, undefined],
    [{ approvedOnly: 'yes' }, ['approvedOnly'], 'yes', undefined],
  ])('DTO %j', async (query, errorProps, approvedOnly, groupHeadId) => {
    const dto = plainToInstance(QueryMonthRangeDto, query);
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(errorProps);
    expect(dto.approvedOnly).toBe(approvedOnly);
    expect(dto.groupHeadId).toBe(groupHeadId);
  });
});
