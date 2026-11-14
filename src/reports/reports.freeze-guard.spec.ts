import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ApprovalStatus } from '@prisma/client';
import { ReportsService } from './reports.service';

// @nestjs/swagger ships ESM that ts-jest cannot load; decorators are no-ops here.
jest.mock('@nestjs/swagger', () => {
  const decorator = () => () => undefined;
  return new Proxy({}, { get: () => decorator });
});
jest.mock('./pdf-generator.service', () => ({ PdfGeneratorService: class {} }));

/**
 * Server-side pre-flight gate on POST /api/v1/reports/freeze.
 * Uses an in-memory Prisma double — no database writes.
 */

type Head = {
  id: string;
  customId: string;
  name: string;
  email: string | null;
  status: string;
  inceptionDate: string;
};
type Cf = {
  groupHeadId: string;
  transactionDate: string;
  approvalStatus: ApprovalStatus;
  voided: boolean;
};
type Cb = {
  groupHeadId: string;
  groupHeadName: string;
  category: string;
  monthKey: string;
  closingAmount: number | null;
  approvalStatus: ApprovalStatus;
  voided: boolean;
};

const PERIOD = '30-09-2026';
const MONTH = '2026-09';
const user = { id: 'mgr-1', name: 'Manager One', role: 'manager' };
const staff = { id: 'stf-1', name: 'Staff One', role: 'staff_entry' };
const REASON = 'Client confirmed PMS valuation by phone; statement due.';

function cleanState() {
  const heads: Head[] = [
    {
      id: 'h1',
      customId: 'GH-1',
      name: 'Alpha',
      email: 'alpha@example.com',
      status: 'Active',
      inceptionDate: '01-04-2025',
    },
    {
      id: 'h2',
      customId: 'GH-2',
      name: 'Beta',
      email: 'beta@example.com',
      status: 'Active',
      inceptionDate: '01-04-2025',
    },
  ];
  const cashflows: Cf[] = [
    {
      groupHeadId: 'h1',
      transactionDate: '15-06-2026',
      approvalStatus: ApprovalStatus.APPROVED,
      voided: false,
    },
    {
      groupHeadId: 'h2',
      transactionDate: '01-04-2025',
      approvalStatus: ApprovalStatus.APPROVED,
      voided: false,
    },
  ];
  const closings: Cb[] = [
    {
      groupHeadId: 'h1',
      groupHeadName: 'Alpha',
      category: 'MF',
      monthKey: MONTH,
      closingAmount: 100,
      approvalStatus: ApprovalStatus.APPROVED,
      voided: false,
    },
    {
      groupHeadId: 'h2',
      groupHeadName: 'Beta',
      category: 'PMS',
      monthKey: MONTH,
      closingAmount: 200,
      approvalStatus: ApprovalStatus.APPROVED,
      voided: false,
    },
  ];
  return {
    heads,
    cashflows,
    closings,
    run: null as null | { id: string; period: string; isFrozen: boolean },
    /** `changes` JSON of FROZEN audit rows for the period, newest first. */
    freezeAudits: [] as Array<Record<string, unknown> | null>,
  };
}

type Where = {
  status?: string;
  id?: string;
  monthKey?: string;
  groupHeadId?: string | { in: string[] };
};
type Blocker = { id: string; type: string; title: string };
type AuditData = {
  reason: string;
  userId: string;
  changes?: {
    override?: boolean;
    gate?: string;
    overrideReason?: string;
    blockers?: Blocker[];
    counts?: Record<string, number>;
  };
};
type BlockedBody = {
  statusCode: number;
  message: string;
  blockers: Blocker[];
  counts: Record<string, number>;
};

function makeService(state: ReturnType<typeof cleanState>) {
  const upsert = jest.fn((args: { create: { period: string } }) =>
    Promise.resolve({
      id: 'run-1',
      period: args.create.period,
      frozenAt: new Date('2026-10-01T05:00:00Z'),
    }),
  );
  const auditCreate = jest.fn((args: { data: AuditData }) => {
    void args;
    return Promise.resolve({});
  });
  const auditFindMany = jest.fn(() =>
    Promise.resolve(state.freezeAudits.map((changes) => ({ changes }))),
  );
  const computeMandateDashboard = jest.fn(() => ({
    dashboard: {
      summary: [
        { returnMethod: 'XIRR' },
        { returnMethod: 'XIRR' },
        { returnMethod: 'AR' },
        { returnMethod: null },
      ],
    },
    dashDataRows: [{}, {}, {}],
    irrCalculatedRows: [{}],
    categoryBreakupRows: [],
  }));
  const populateWorkbook = jest.fn();
  const assertPeriodFrozenForDispatch = jest.fn(() => Promise.resolve());
  const indicesFindMany = jest.fn(() => Promise.resolve([{ date: PERIOD }]));
  const prisma = {
    groupHead: {
      findMany: jest.fn((args: { where: Where }) =>
        Promise.resolve(
          state.heads.filter(
            (h) =>
              h.status === args.where.status &&
              (!args.where.id || h.id === args.where.id),
          ),
        ),
      ),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    masterCashflow: {
      findMany: jest.fn(() =>
        Promise.resolve(state.cashflows.filter((c) => !c.voided)),
      ),
    },
    closingBalance: {
      findMany: jest.fn((args: { where: Where }) =>
        Promise.resolve(
          state.closings.filter(
            (b) =>
              !b.voided &&
              (args.where.monthKey === undefined ||
                b.monthKey === args.where.monthKey),
          ),
        ),
      ),
    },
    hybridAllocationRule: { findMany: jest.fn(() => Promise.resolve([])) },
    indicesDataRecord: { findMany: indicesFindMany },
    reportingRun: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          state.run
            ? { ...state.run, auditEntries: [], monthKey: MONTH }
            : null,
        ),
      ),
      upsert,
    },
    auditTrail: { create: auditCreate, findMany: auditFindMany },
  };
  const service = new ReportsService(
    prisma as unknown as ConstructorParameters<typeof ReportsService>[0],
    {
      computeMandateDashboard,
      populateWorkbook,
    } as unknown as ConstructorParameters<typeof ReportsService>[1],
    {} as ConstructorParameters<typeof ReportsService>[2],
    {
      assertPeriodFrozenForDispatch,
    } as unknown as ConstructorParameters<typeof ReportsService>[3],
  );
  return {
    service,
    upsert,
    auditCreate,
    auditFindMany,
    indicesFindMany,
    populateWorkbook,
  };
}

async function expectBlocked(
  state: ReturnType<typeof cleanState>,
  blockerType: string,
): Promise<BlockedBody> {
  const { service, upsert, auditCreate } = makeService(state);
  const err: unknown = await service
    .freezeReportingRun({ period: PERIOD }, user)
    .then(() => null)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConflictException);
  const body = (err as ConflictException).getResponse() as BlockedBody;
  expect(body.statusCode).toBe(409);
  expect(body.message).toMatch(
    /^Cannot freeze 30-09-2026: \d+ pre-flight blocker/,
  );
  expect(body.blockers.map((b) => b.type)).toContain(blockerType);
  expect(upsert).not.toHaveBeenCalled();
  expect(auditCreate).not.toHaveBeenCalled();
  return body;
}

describe('ReportsService.freezeReportingRun — server pre-flight gate', () => {
  it('freezes when every gate is clean', async () => {
    const state = cleanState();
    const { service, upsert, auditCreate } = makeService(state);
    const audit = await service.getPreFlightAudit(PERIOD, MONTH);
    expect(audit.isReadyToFreeze).toBe(true);
    const res = await service.freezeReportingRun({ period: PERIOD }, user);
    expect(res.isFrozen).toBe(true);
    expect(res.frozenPeriod).toBe(PERIOD);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('blocks when a closing balance row has no amount', async () => {
    const state = cleanState();
    state.closings[0].closingAmount = null;
    const body = await expectBlocked(state, 'missing_balance');
    expect(body.counts.missingBalances).toBe(1);
  });

  it('blocks when a client with approved trades has no closing row for the month', async () => {
    const state = cleanState();
    state.closings = state.closings.filter((b) => b.groupHeadId !== 'h2');
    const body = await expectBlocked(state, 'missing_balance');
    expect(
      body.blockers.find((b) => b.id === 'missing-balance-rows')?.title,
    ).toMatch(/1 Client with no closing balance for 2026-09/);
  });

  it("does not require a closing row when the client's only trade is after the period end", async () => {
    const state = cleanState();
    state.closings = state.closings.filter((b) => b.groupHeadId !== 'h2');
    state.cashflows[1].transactionDate = '05-10-2026';
    const { service } = makeService(state);
    await expect(
      service.freezeReportingRun({ period: PERIOD }, user),
    ).resolves.toMatchObject({
      isFrozen: true,
    });
  });

  it('blocks when a cashflow is pending approval', async () => {
    const state = cleanState();
    state.cashflows.push({
      groupHeadId: 'h1',
      transactionDate: '20-09-2026',
      approvalStatus: ApprovalStatus.PENDING,
      voided: false,
    });
    const body = await expectBlocked(state, 'pending_trade');
    expect(body.counts.pendingTrades).toBe(1);
  });

  it('blocks when a closing balance is pending approval', async () => {
    const state = cleanState();
    state.closings[1].approvalStatus = ApprovalStatus.PENDING;
    await expectBlocked(state, 'pending_balance');
  });

  it('blocks when an active client has no valid recipient email', async () => {
    const state = cleanState();
    state.heads[1].email = 'not-an-email';
    await expectBlocked(state, 'missing_email');
  });

  it('lists every blocker when several fail together', async () => {
    const state = cleanState();
    state.closings[0].closingAmount = null;
    state.closings[1].approvalStatus = ApprovalStatus.PENDING;
    state.heads[0].email = '';
    state.cashflows.push({
      groupHeadId: 'h2',
      transactionDate: '01-09-2026',
      approvalStatus: ApprovalStatus.PENDING,
      voided: false,
    });
    const body = await expectBlocked(state, 'missing_email');
    expect(body.blockers.map((b) => b.type).sort()).toEqual(
      [
        'missing_balance',
        'missing_email',
        'pending_balance',
        'pending_trade',
      ].sort(),
    );
    expect(body.message).toMatch(/4 pre-flight blockers/);
  });

  it('ignores voided rows and treats returned items / missing benchmark as warnings only', async () => {
    const state = cleanState();
    state.cashflows.push({
      groupHeadId: 'h1',
      transactionDate: '20-09-2026',
      approvalStatus: ApprovalStatus.PENDING,
      voided: true,
    });
    state.cashflows.push({
      groupHeadId: 'h1',
      transactionDate: '21-09-2026',
      approvalStatus: ApprovalStatus.RETURNED,
      voided: false,
    });
    const { service, indicesFindMany } = makeService(state);
    indicesFindMany.mockImplementation(() => Promise.resolve([]));
    const audit = await service.getPreFlightAudit(PERIOD, MONTH);
    expect(audit.issues.map((i: { severity: string }) => i.severity)).toEqual([
      'warning',
      'warning',
    ]);
    await expect(
      service.freezeReportingRun({ period: PERIOD }, user),
    ).resolves.toMatchObject({
      isFrozen: true,
    });
  });

  it('rejects freezing an already-frozen period with 409', async () => {
    const state = cleanState();
    state.run = { id: 'run-1', period: PERIOD, isFrozen: true };
    const { service, upsert } = makeService(state);
    await expect(
      service.freezeReportingRun({ period: PERIOD }, user),
    ).rejects.toThrow(/already frozen/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['2026-09', '31-02-2026', 'garbage', ''])(
    'rejects an invalid period "%s" with 400',
    async (period) => {
      const { service, upsert } = makeService(cleanState());
      await expect(
        service.freezeReportingRun({ period }, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('rejects a monthKey that does not match the period with 400', async () => {
    const { service, upsert } = makeService(cleanState());
    await expect(
      service.freezeReportingRun({ period: PERIOD, monthKey: '2026-11' }, user),
    ).rejects.toThrow(/does not match/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('marks blocked responses as overridable', async () => {
    const state = cleanState();
    state.heads[0].email = null;
    const body = await expectBlocked(state, 'missing_email');
    expect((body as BlockedBody & { overridable?: boolean }).overridable).toBe(
      true,
    );
  });
});

describe('freeze override (Manager / Super Admin, logged reason)', () => {
  const blockedState = () => {
    const state = cleanState();
    state.heads[0].email = null;
    state.closings[1].approvalStatus = ApprovalStatus.PENDING;
    return state;
  };

  it('denies staff with 403 even with a reason', async () => {
    const { service, upsert, auditCreate } = makeService(blockedState());
    await expect(
      service.freezeReportingRun(
        { period: PERIOD, forceOverride: true, overrideReason: REASON },
        staff,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('denies a caller with no role', async () => {
    const { service } = makeService(blockedState());
    await expect(
      service.freezeReportingRun(
        { period: PERIOD, forceOverride: true, overrideReason: REASON },
        { id: 'x', name: 'x' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([undefined, '', '   ', 'too short', '  short    '])(
    'rejects a manager override with reason %p (400)',
    async (overrideReason) => {
      const { service, upsert } = makeService(blockedState());
      await expect(
        service.freezeReportingRun(
          { period: PERIOD, forceOverride: true, overrideReason },
          user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('freezes with a valid reason and logs user, reason, blockers and counts', async () => {
    const { service, upsert, auditCreate } = makeService(blockedState());
    const res = await service.freezeReportingRun(
      { period: PERIOD, forceOverride: true, overrideReason: `  ${REASON}  ` },
      { ...user, role: 'super_admin' },
    );
    expect(res.isFrozen).toBe(true);
    expect(res.override?.reason).toBe(REASON);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const data = auditCreate.mock.calls[0][0].data;
    expect(data.userId).toBe('mgr-1');
    expect(data.reason).toBe(`PRE-FLIGHT OVERRIDE (2 blockers): ${REASON}`);
    expect(data.changes?.override).toBe(true);
    expect(data.changes?.gate).toBe('freeze');
    expect(data.changes?.overrideReason).toBe(REASON);
    expect(data.changes?.blockers?.map((b) => b.type).sort()).toEqual([
      'missing_email',
      'pending_balance',
    ]);
    expect(data.changes?.counts?.missingEmails).toBe(1);
  });

  it('does not record an override when the gate is already clean', async () => {
    const { service, auditCreate } = makeService(cleanState());
    const res = await service.freezeReportingRun(
      { period: PERIOD, forceOverride: true, overrideReason: REASON },
      user,
    );
    expect(res.override).toBeNull();
    const data = auditCreate.mock.calls[0][0].data;
    expect(data.changes).toBeUndefined();
    expect(data.reason).toMatch(/All pre-flight audits verified/);
  });

  it('still refuses to re-freeze an already-frozen period', async () => {
    const state = blockedState();
    state.run = { id: 'run-1', period: PERIOD, isFrozen: true };
    const { service } = makeService(state);
    await expect(
      service.freezeReportingRun(
        { period: PERIOD, forceOverride: true, overrideReason: REASON },
        user,
      ),
    ).rejects.toThrow(/already frozen/);
  });
});

describe('pre-flight: inception date after first trade (warning only)', () => {
  it('warns but does not block', async () => {
    const state = cleanState();
    state.heads[0].inceptionDate = '17-10-2026'; // first trade 15-06-2026
    const { service } = makeService(state);
    const audit = await service.getPreFlightAudit(PERIOD, MONTH);
    const issue = audit.issues.find(
      (i: { id: string }) => i.id === 'inception-after-first-trade',
    ) as { severity: string; description: string } | undefined;
    expect(issue?.severity).toBe('warning');
    expect(issue?.description).toMatch(
      /17-10-2026 is after its first trade on 15-06-2026/,
    );
    expect(audit.isReadyToFreeze).toBe(true);
    expect(audit.counts.inceptionWarnings).toBe(1);
  });

  it('does not warn when inception is on or before the first trade', async () => {
    const state = cleanState();
    state.heads[0].inceptionDate = '15-06-2026';
    const { service } = makeService(state);
    const audit = await service.getPreFlightAudit(PERIOD, MONTH);
    expect(audit.counts.inceptionWarnings).toBe(0);
  });
});

describe('calculation run: FR-3.3 missing-balance gate', () => {
  const missingState = () => {
    const state = cleanState();
    state.closings[0].closingAmount = null;
    return state;
  };
  const calcDto = { period: PERIOD, groupHeadId: 'All' };

  it('blocks with 409 when closing balances are missing', async () => {
    const { service, populateWorkbook } = makeService(missingState());
    const err: unknown = await service
      .executeCalculationRun(calcDto, user)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as BlockedBody;
    expect(body.message).toMatch(/closing balances are missing \(FR-3\.3\)/);
    expect(body.blockers.every((b) => b.type === 'missing_balance')).toBe(true);
    expect(populateWorkbook).not.toHaveBeenCalled();
  });

  it('ignores non-balance blockers (pending approvals are excluded from the calc anyway)', async () => {
    const state = cleanState();
    state.heads[0].email = null;
    const { service } = makeService(state);
    await expect(
      service.executeCalculationRun(calcDto, user),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('does not reuse a freeze override — the run needs its own', async () => {
    const state = missingState();
    state.freezeAudits = [{ override: true, gate: 'freeze' }];
    const { service, auditFindMany, populateWorkbook } = makeService(state);
    const err: unknown = await service
      .executeCalculationRun(calcDto, user)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(
      ((err as ConflictException).getResponse() as { overridable?: boolean })
        .overridable,
    ).toBe(true);
    expect(auditFindMany).not.toHaveBeenCalled();
    expect(populateWorkbook).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'too short'])(
    'rejects a run override with reason %p (400)',
    async (overrideReason) => {
      const { service, populateWorkbook } = makeService(missingState());
      await expect(
        service.executeCalculationRun(
          { ...calcDto, forceOverride: true, overrideReason },
          user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(populateWorkbook).not.toHaveBeenCalled();
    },
  );

  it('runs with an explicit run override and logs it', async () => {
    const { service, auditCreate } = makeService(missingState());
    const res = await service.executeCalculationRun(
      { ...calcDto, forceOverride: true, overrideReason: REASON },
      user,
    );
    expect(res.summary.status).toBe('warning');
    expect(res.summary.override?.reason).toBe(REASON);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const data = auditCreate.mock.calls[0][0].data;
    expect(data.userId).toBe('mgr-1');
    expect(data.reason).toBe(
      `CALCULATION OVERRIDE (missing closing balances): ${REASON}`,
    );
    expect(data.changes?.override).toBe(true);
    expect(data.changes?.gate).toBe('calculate');
    expect(data.changes?.overrideReason).toBe(REASON);
    expect(data.changes?.blockers?.map((b) => b.type)).toEqual([
      'missing_balance',
    ]);
  });

  it('denies a staff run override', async () => {
    const { service } = makeService(missingState());
    await expect(
      service.executeCalculationRun(
        { ...calcDto, forceOverride: true, overrideReason: REASON },
        staff,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('logs no override when balances are complete', async () => {
    const { service, auditCreate } = makeService(cleanState());
    const res = await service.executeCalculationRun(
      { ...calcDto, forceOverride: true, overrideReason: REASON },
      user,
    );
    expect(res.summary.status).toBe('success');
    expect(res.summary.override).toBeNull();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('reports real XIRR / Point-to-Point counts from the engine', async () => {
    const { service } = makeService(cleanState());
    const res = await service.executeCalculationRun(calcDto, user);
    // 2 active mandates × (2 XIRR + 1 AR + 1 n/a) rows
    expect(res.summary.xirrPeriodsCount).toBe(4);
    expect(res.summary.p2pPeriodsCount).toBe(2);
    expect(res.summary.formulasUpdated).toBe(8);
    expect(res.stages[3]).toMatch(
      /4 periods with XIRR and 2 periods with Point-to-Point return across 2 mandates/,
    );
  });
});
