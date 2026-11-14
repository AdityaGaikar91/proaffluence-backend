import { BadRequestException } from '@nestjs/common';

// @nestjs/swagger ships ESM that ts-jest cannot load; decorators are no-ops here.
jest.mock('@nestjs/swagger', () => {
  const noop = () => () => undefined;
  return new Proxy({}, { get: () => noop });
});

import { GroupHeadsService } from './group-heads.service';
import type { CreateGroupHeadDto } from './dto/create-group-head.dto';

/** FR-1.2: Inception Date may not be after the Group Head's first trade. */

type Cf = {
  groupHeadId: string;
  transactionDate: string;
  voided?: boolean;
};

const HEAD = {
  id: 'gh-1',
  customId: 'GH-0001',
  name: 'Alpha',
  contactPerson: 'Alpha',
  email: 'a@example.com',
  secondaryEmail: null,
  inceptionDate: '17-10-2026',
  pan: 'ABCDE1234F',
  status: 'Active',
  notes: null,
  categories: ['MF'],
  totalAum: 0,
  netInvestment: 0,
  familyMembers: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(cashflows: Cf[]) {
  const update = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...HEAD, ...args.data, familyMembers: [] }),
  );
  const create = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...HEAD, ...args.data, familyMembers: [] }),
  );
  const auditCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    void args;
    return Promise.resolve({});
  });
  const cfFindMany = jest.fn(
    (args: { where: { groupHeadId: { in: string[] } } }) =>
      Promise.resolve(
        cashflows.filter(
          (c) => !c.voided && args.where.groupHeadId.in.includes(c.groupHeadId),
        ),
      ),
  );
  const tx = {
    groupHead: {
      findUnique: jest.fn(() => Promise.resolve(HEAD)),
      findFirst: jest.fn(() => Promise.resolve(null)),
      findMany: jest.fn(() => Promise.resolve([])),
      update,
      create,
    },
    masterCashflow: { findMany: cfFindMany, updateMany: jest.fn() },
    closingBalance: { updateMany: jest.fn() },
    auditTrail: { create: auditCreate },
  };
  const prisma = {
    ...tx,
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const service = new GroupHeadsService(
    prisma as unknown as ConstructorParameters<typeof GroupHeadsService>[0],
  );
  return { service, update, create, auditCreate };
}

const trades: Cf[] = [
  { groupHeadId: 'gh-1', transactionDate: '15-06-2019' },
  { groupHeadId: 'gh-1', transactionDate: '04-04-2018' },
  { groupHeadId: 'gh-1', transactionDate: '01-01-2010', voided: true },
  { groupHeadId: 'gh-2', transactionDate: '01-01-2001' },
];
const actor = { id: 'u-1', name: 'Manager One' };

describe('Group Head inception date validation', () => {
  it('rejects an inception date after the first trade with a clear message', async () => {
    const { service, update } = makeService(trades);
    await expect(
      service.update('gh-1', { inceptionDate: '05-04-2018' }, actor),
    ).rejects.toThrow(
      "Inception Date 05-04-2018 cannot be after this Group Head's first trade on 04-04-2018. Use 04-04-2018 or earlier (FR-1.2).",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['04-04-2018', '01-04-2018'])(
    'accepts inception %s (on or before the first trade; voided trades ignored)',
    async (inceptionDate) => {
      const { service, update } = makeService(trades);
      await service.update('gh-1', { inceptionDate }, actor);
      expect(update.mock.calls[0][0].data.inceptionDate).toBe(inceptionDate);
    },
  );

  it('audits the inception change with from / to', async () => {
    const { service, auditCreate } = makeService(trades);
    await service.update('gh-1', { inceptionDate: ' 04-04-2018 ' }, actor);
    expect(auditCreate.mock.calls[0][0].data.changes).toEqual({
      groupHeadId: 'gh-1',
      inceptionDate: { from: '17-10-2026', to: '04-04-2018' },
    });
  });

  it('allows any valid date when the Group Head has no trades', async () => {
    const { service, update } = makeService([]);
    await service.update('gh-1', { inceptionDate: '01-12-2030' }, actor);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not check inception when the update does not change it', async () => {
    const { service, update } = makeService(trades);
    await service.update('gh-1', { notes: 'hello' }, actor);
    expect(update.mock.calls[0][0].data.inceptionDate).toBe('17-10-2026');
  });

  it.each(['31-02-2026', '00-01-2020'])(
    'rejects an impossible date %s with 400',
    async (inceptionDate) => {
      const { service } = makeService([]);
      await expect(
        service.update('gh-1', { inceptionDate }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('allows create (no trades yet) and stores the trimmed date', async () => {
    const { service, create } = makeService(trades);
    const dto = {
      name: 'Beta',
      email: 'b@example.com',
      pan: 'ABCDE1234F',
      inceptionDate: ' 17-10-2026 ',
    } as CreateGroupHeadDto;
    await service.create(dto, actor);
    expect(create.mock.calls[0][0].data.inceptionDate).toBe('17-10-2026');
  });

  it('rejects create with an impossible date', async () => {
    const { service, create } = makeService([]);
    const dto = {
      name: 'Beta',
      email: 'b@example.com',
      pan: 'ABCDE1234F',
      inceptionDate: '30-02-2026',
    } as CreateGroupHeadDto;
    await expect(service.create(dto, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
