import { Test, TestingModule } from '@nestjs/testing';
import { TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  CashflowMathService,
  CashflowLot,
  CandidateCashflowRow,
} from './cashflow-math.service';
import { parseDdMmYyyy } from '../reports/financial-math.util';

describe('CashflowMathService', () => {
  let service: CashflowMathService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CashflowMathService],
    }).compile();

    service = module.get<CashflowMathService>(CashflowMathService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateNewInvestments', () => {
    it('returns negative amount for PURCHASE (investor outflow)', () => {
      expect(
        service.calculateNewInvestments(TransactionType.PURCHASE, 50000),
      ).toBe(-50000);
      expect(
        service.calculateNewInvestments(TransactionType.PURCHASE, 12345.678),
      ).toBe(-12345.68);
    });

    it('returns positive amount for REDEMPTION (investor inflow)', () => {
      expect(
        service.calculateNewInvestments(TransactionType.REDEMPTION, 50000),
      ).toBe(50000);
      expect(
        service.calculateNewInvestments(TransactionType.REDEMPTION, 12345.678),
      ).toBe(12345.68);
    });
  });

  describe('allocateFifoLots', () => {
    it('allocates against a single lot with exact amount', () => {
      const lots: CashflowLot[] = [
        {
          cashflowId: 'lot-1',
          transactionDate: '01-01-2026',
          parsedDate: parseDdMmYyyy('01-01-2026'),
          groupHeadId: 'GH-1',
          familyMemberId: 'FM-1',
          category: 'MF',
          subCategory: 'Growth Fund',
          originalAmount: new Decimal(100000),
          remainingAmount: new Decimal(100000),
        },
      ];

      const res = service.allocateFifoLots('01-04-2026', 100000, lots);
      expect(res.matchedLots.length).toBe(1);
      expect(res.matchedLots[0].lotId).toBe('lot-1');
      expect(res.matchedLots[0].costBasis).toBe(100000);
      expect(res.unmatchedAmount).toBe(0);
      expect(res.totalCostBasis).toBe(100000);
      expect(res.realizedProfitLoss).toBe(0); // 100000 - 100000
      expect(lots[0].remainingAmount.toNumber()).toBe(0);
    });

    it('allocates across multiple purchase lots in FIFO order', () => {
      const lots: CashflowLot[] = [
        {
          cashflowId: 'lot-1',
          transactionDate: '01-01-2025',
          parsedDate: parseDdMmYyyy('01-01-2025'),
          groupHeadId: 'GH-1',
          familyMemberId: 'FM-1',
          category: 'MF',
          subCategory: 'Growth Fund',
          originalAmount: new Decimal(40000),
          remainingAmount: new Decimal(40000),
        },
        {
          cashflowId: 'lot-2',
          transactionDate: '01-06-2025',
          parsedDate: parseDdMmYyyy('01-06-2025'),
          groupHeadId: 'GH-1',
          familyMemberId: 'FM-1',
          category: 'MF',
          subCategory: 'Growth Fund',
          originalAmount: new Decimal(60000),
          remainingAmount: new Decimal(60000),
        },
      ];

      // Redeem 70,000 -> consumes 40,000 from lot-1 and 30,000 from lot-2
      const res = service.allocateFifoLots('01-10-2025', 70000, lots);
      expect(res.matchedLots.length).toBe(2);
      expect(res.matchedLots[0].lotId).toBe('lot-1');
      expect(res.matchedLots[0].costBasis).toBe(40000);
      expect(res.matchedLots[1].lotId).toBe('lot-2');
      expect(res.matchedLots[1].costBasis).toBe(30000);

      expect(lots[0].remainingAmount.toNumber()).toBe(0);
      expect(lots[1].remainingAmount.toNumber()).toBe(30000); // 60000 - 30000 remaining
      expect(res.unmatchedAmount).toBe(0);
    });

    it('handles redemptions exceeding available purchase lots (legacy holdings)', () => {
      const lots: CashflowLot[] = [
        {
          cashflowId: 'lot-1',
          transactionDate: '01-01-2026',
          parsedDate: parseDdMmYyyy('01-01-2026'),
          groupHeadId: 'GH-1',
          category: 'MF',
          subCategory: 'Growth Fund',
          originalAmount: new Decimal(50000),
          remainingAmount: new Decimal(50000),
        },
      ];

      // Redeem 80,000 when only 50,000 is available
      const res = service.allocateFifoLots('01-05-2026', 80000, lots);
      expect(res.matchedLots.length).toBe(1);
      expect(res.matchedLots[0].costBasis).toBe(50000);
      expect(res.unmatchedAmount).toBe(30000);
      // Unmatched portion cost basis equals 30000, so realized P/L is 0
      expect(res.realizedProfitLoss).toBe(0);
      expect(res.totalCostBasis).toBe(80000);
      expect(lots[0].remainingAmount.toNumber()).toBe(0);
    });
  });

  describe('calculateReturnFromMatchedLots', () => {
    it('calculates Point-to-Point Absolute Return for holding period < 364 days', () => {
      // 100 days holding period: Purchase cost 100,000, Redemption 115,000 -> +15%
      const matchedLots = [
        {
          lotId: 'lot-1',
          purchaseDate: '01-01-2026',
          costBasis: 100000,
          redeemedAmount: 100000,
          holdingDays: 100,
        },
      ];
      const redemptionDate = parseDdMmYyyy('11-04-2026'); // ~100 days later
      const xirr = service.calculateReturnFromMatchedLots(
        redemptionDate,
        matchedLots,
        new Decimal(115000),
        new Decimal(100000),
      );
      expect(xirr).toBe(15.0); // 15% absolute return
    });

    it('calculates Annualized XIRR for holding period >= 364 days', () => {
      // Exactly 1 year (365 days): Purchase 100,000, Redemption 115,000 -> ~15% annualized
      const matchedLots = [
        {
          lotId: 'lot-1',
          purchaseDate: '01-01-2025',
          costBasis: 100000,
          redeemedAmount: 100000,
          holdingDays: 365,
        },
      ];
      const redemptionDate = parseDdMmYyyy('01-01-2026');
      const xirr = service.calculateReturnFromMatchedLots(
        redemptionDate,
        matchedLots,
        new Decimal(115000),
        new Decimal(100000),
      );
      expect(xirr).toBeGreaterThan(14.9);
      expect(xirr).toBeLessThan(15.1);
    });
  });

  describe('processSequence', () => {
    it('processes a sequential stream of transactions chronologically', () => {
      const incoming: CandidateCashflowRow[] = [
        {
          transactionDate: '01-01-2026',
          transactionType: TransactionType.PURCHASE,
          groupHeadId: 'GH-100',
          familyMemberId: 'FM-1',
          category: 'MF',
          subCategory: 'Axis Bluechip',
          amounts: 100000,
        },
        {
          transactionDate: '01-06-2026',
          transactionType: TransactionType.PURCHASE,
          groupHeadId: 'GH-100',
          familyMemberId: 'FM-1',
          category: 'MF',
          subCategory: 'Axis Bluechip',
          amounts: 50000,
        },
        {
          transactionDate: '01-10-2026',
          transactionType: TransactionType.REDEMPTION,
          groupHeadId: 'GH-100',
          familyMemberId: 'FM-1',
          category: 'MF',
          subCategory: 'Axis Bluechip',
          amounts: 120000,
        },
      ];

      const results = service.processSequence([], incoming);
      expect(results.length).toBe(3);

      // Row 0: Purchase 100k
      expect(results[0].newInvestments).toBe(-100000);
      expect(results[0].profitLoss).toBe(0);
      expect(results[0].xirr).toBe(0);

      // Row 1: Purchase 50k
      expect(results[1].newInvestments).toBe(-50000);
      expect(results[1].profitLoss).toBe(0);
      expect(results[1].xirr).toBe(0);

      // Row 2: Redemption 120k (consumes 100k lot-1 and 20k lot-2)
      expect(results[2].newInvestments).toBe(120000);
      expect(results[2].matchedLots.length).toBe(2);
      expect(results[2].matchedLots[0].costBasis).toBe(100000);
      expect(results[2].matchedLots[1].costBasis).toBe(20000);
      expect(results[2].totalCostBasis).toBe(120000);
      expect(results[2].profitLoss).toBe(0);
    });
  });
});
