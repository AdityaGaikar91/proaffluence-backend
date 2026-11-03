/**
 * End-to-end flow test for Output_GL_123 Excel:
 * create Group Head → load Master Cashflows + Closing Balances →
 * approve/preflight → calculate → annual dashboard vs Excel → encrypted PDF.
 *
 * Usage: node scripts/e2e-gl123-flow.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { PrismaClient, ApprovalStatus, Prisma } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EXCEL = path.join(
  ROOT,
  'docs/Output_GL_123_01-Apr-18 to 30-Sep-26.xlsx',
);
const BASE = process.env.API_BASE || 'http://localhost:8002';
const PERIOD = '30-09-2026';
const COOKIE_JAR = path.join('/tmp', 'pa_gl123_cookies.txt');
const OUT_DIR = path.join('/tmp', 'proaffluence_e2e_gl123');
const prisma = new PrismaClient();

function excelSerialToDate(serial) {
  // Excel 1900 date system (UTC)
  const ms = Date.UTC(1899, 11, 30) + Number(serial) * 86400000;
  return new Date(ms);
}

function formatDdMmYyyy(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function monthKeyFromDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFromKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${names[m - 1]} ${y}`;
}

function toDdMm(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return formatDdMmYyyy(excelSerialToDate(value));
  const s = String(value).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [a, b, c] = s.split('/').map(Number);
    const yyyy = c < 100 ? 2000 + c : c;
    return formatDdMmYyyy(new Date(Date.UTC(yyyy, b - 1, a)));
  }
  return s;
}

function sheetTable(wb, name) {
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    defval: null,
    raw: true,
  });
  const hi = raw.findIndex(
    (r) => r && r.some((c) => String(c || '').trim() === 'Sr_No'),
  );
  if (hi < 0) throw new Error(`No Sr_No header in sheet ${name}`);
  const headers = raw[hi].map((h) => (h == null ? '' : String(h).trim()));
  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.every((c) => c === null || c === '')) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = r[idx];
    });
    rows.push(obj);
  }
  return rows;
}

function parseExcelExpectations(wb) {
  const grid = XLSX.utils.sheet_to_json(wb.Sheets['FY Annual Dashboard'], {
    header: 1,
    defval: null,
    raw: true,
  });
  const summary = [];
  const xirr = [];
  let mode = null;
  for (const row of grid) {
    if (!row) continue;
    const label = row[1];
    if (label === 'SUMMARY :') {
      mode = 'summary';
      continue;
    }
    if (label === 'XIRR :') {
      mode = 'xirr';
      continue;
    }
    if (mode === 'summary' && typeof label === 'string' && label !== 'Financial Year') {
      summary.push({
        financialYear: label,
        valueAsOn3103: row[2] === '-' || row[2] === '' ? null : row[2],
        newInvestments: row[3] === '-' || row[3] === '' ? null : row[3],
        xirr: row[4] === '-' || row[4] === '' ? null : row[4],
      });
      if (String(label).startsWith('Net Investment')) mode = null;
    }
    if (mode === 'xirr') {
      if (typeof label !== 'string') continue;
      if (label.includes('Asset Allocation')) {
        mode = null;
        continue;
      }
      if (!/^(Since Inception|FY \d{4}-\d{2})$/.test(label)) continue;
      xirr.push({
        financialYear: label,
        portfolio: row[2] ?? null,
        mf: row[3] ?? null,
        pms: row[4] ?? null,
        stock: row[5] ?? null,
      });
    }
  }
  return { summary, xirr };
}

async function signIn() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify({
      email: 'manager1@proaffluence.com',
      password: '@Test123',
    }),
  });
  if (!res.ok) throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookieHeader =
    setCookie.map((c) => c.split(';')[0]).join('; ') ||
    (res.headers.get('set-cookie') || '').split(',').map((c) => c.split(';')[0].trim()).join('; ');
  fs.writeFileSync(COOKIE_JAR, cookieHeader);
  return cookieHeader;
}

async function api(cookie, method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Cookie: cookie,
      Origin: 'http://localhost:5173',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, json, headers: res.headers, buffer: null, text };
}

async function apiBinary(cookie, urlPath) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method: 'GET',
    headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ok: res.ok, buffer: buf, headers: res.headers };
}

function nearlyEqual(a, b, absTol = 2, pctTol = 0.02) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  if (Math.abs(na - nb) <= absTol) return true;
  if (Math.abs(nb) > 1 && Math.abs(na - nb) / Math.abs(nb) <= pctTol) return true;
  return false;
}

function normalizeCat(c) {
  const u = String(c || '').trim().toUpperCase();
  if (u === 'STOCK' || u === 'STOCKS') return 'STOCKS';
  if (u === 'MUTUAL FUND' || u === 'MUTUAL_FUND') return 'MF';
  return u;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== GL-123 E2E Flow ===');
  console.log('Excel:', EXCEL);

  if (!fs.existsSync(EXCEL)) throw new Error('Excel file missing');

  const wb = XLSX.readFile(EXCEL);
  const expected = parseExcelExpectations(wb);
  const cashflows = sheetTable(wb, 'Master Cashflows');
  const closings = sheetTable(wb, 'Closing Balances');
  console.log(`Parsed CF=${cashflows.length} CB=${closings.length}`);
  console.log(`Excel SI XIRR=${expected.summary.find((r) => r.financialYear === 'Since Inception')?.xirr}`);

  const cookie = await signIn();
  console.log('Signed in as manager1');

  const manager = await prisma.user.findFirst({
    where: { email: 'manager1@proaffluence.com' },
  });
  if (!manager) throw new Error('manager1 user missing — run seed');
  const actorId = manager.id;
  const actorName = manager.name || 'Priya S. (Manager)';

  // 1) Create / reuse Group Head "123"
  let gh = await prisma.groupHead.findFirst({
    where: { OR: [{ name: '123' }, { customId: '123' }] },
  });
  if (!gh) {
    const createRes = await api(cookie, 'POST', '/api/v1/group-heads', {
      customId: '123',
      name: '123',
      contactPerson: 'GL 123',
      email: 'gl123@proaffluence.test',
      inceptionDate: '01-04-2018',
      pan: 'ABCDE1234G',
      status: 'Active',
      notes: 'Loaded from Output_GL_123 Excel e2e flow',
      familyMembers: ['123'],
      categories: ['MF', 'PMS', 'STOCKS'],
    });
    if (!createRes.ok) {
      throw new Error(`Create group head failed: ${createRes.status} ${JSON.stringify(createRes.json)}`);
    }
    gh = await prisma.groupHead.findFirst({
      where: { OR: [{ name: '123' }, { customId: '123' }] },
    });
    console.log('Created Group Head 123', gh.id);
  } else {
    console.log('Reusing Group Head 123', gh.id);
  }

  // Wipe prior ledger for this head so re-runs are idempotent
  await prisma.auditTrail.deleteMany({
    where: {
      OR: [
        { cashflow: { groupHeadId: gh.id } },
        { balance: { groupHeadId: gh.id } },
      ],
    },
  });
  await prisma.masterCashflow.deleteMany({ where: { groupHeadId: gh.id } });
  await prisma.closingBalance.deleteMany({ where: { groupHeadId: gh.id } });
  console.log('Cleared prior CF/CB for head 123');

  // 2) Load cashflows (omit Excel Sr_No — global unique would 409; auto-seq)
  const [cfMax, cbMax] = await Promise.all([
    prisma.masterCashflow.findFirst({ orderBy: { srNo: 'desc' }, select: { srNo: true } }),
    prisma.closingBalance.findFirst({ orderBy: { srNo: 'desc' }, select: { srNo: true } }),
  ]);
  let nextCfSr = (cfMax?.srNo ?? 0) + 1;
  let nextCbSr = (cbMax?.srNo ?? 0) + 1;

  const cfData = [];
  for (const row of cashflows) {
    const txDate = toDdMm(row.Transaction_Date);
    const entryDate = toDdMm(row.Date_Of_Entry) || txDate;
    if (!txDate) continue;
    const typeRaw = String(row.Transaction_Type || '').trim().toUpperCase();
    const transactionType =
      typeRaw.startsWith('RED') ? 'REDEMPTION' : 'PURCHASE';
    const category = normalizeCat(row.Category);
    if (!['MF', 'PMS', 'STOCKS'].includes(category)) continue;
    const amounts = Number(row.Amounts);
    if (!Number.isFinite(amounts)) continue;

    cfData.push({
      srNo: nextCfSr++,
      dateOfEntry: entryDate,
      userId: String(row.User_Id || 'ProAffluence'),
      month: String(row.Month || ''),
      clientOwner: String(row.Client_Owner || 'ProAffluence Associates Private Limited'),
      groupHeadId: gh.id,
      groupHeadName: gh.name,
      familyMemberName: String(row.Family_Member_Name || '123'),
      transactionDate: txDate,
      transactionType,
      category,
      subCategory: String(row.Sub_Category || 'EQUITY').toUpperCase(),
      amounts: new Prisma.Decimal(amounts),
      newInvestments: new Prisma.Decimal(
        row.New_Investments == null || row.New_Investments === ''
          ? 0
          : Number(row.New_Investments),
      ),
      profitLoss: new Prisma.Decimal(
        row.Profit_Loss == null || row.Profit_Loss === ''
          ? 0
          : Number(row.Profit_Loss),
      ),
      xirr: new Prisma.Decimal(
        row.XIRR == null || row.XIRR === '' ? 0 : Number(row.XIRR),
      ),
      approvalStatus: ApprovalStatus.APPROVED,
      voided: false,
      submittedById: actorId,
      submittedByName: actorName,
      submittedAt: new Date(),
      approvedById: actorId,
      approvedByName: actorName,
      approvedAt: new Date(),
    });
  }

  // Chunked createMany
  for (let i = 0; i < cfData.length; i += 100) {
    await prisma.masterCashflow.createMany({ data: cfData.slice(i, i + 100) });
  }
  console.log(`Loaded ${cfData.length} cashflows (APPROVED, auto Sr_No)`);

  // 3) Load closings — monthKey from Month column (valuation month), not Date_Of_Entry.
  // Aggregate same monthKey+family+category+subCategory (Excel sum parity / DB unique).
  const cbAgg = new Map();
  for (const row of closings) {
    if (row.Closing_Amount == null || row.Closing_Amount === '') continue;
    const monthSerial = row.Month;
    if (typeof monthSerial !== 'number') continue;
    const monthDate = excelSerialToDate(monthSerial);
    const monthKey = monthKeyFromDate(monthDate);
    const dateOfEntry =
      toDdMm(row.Date_Of_Entry) || formatDdMmYyyy(monthDate);
    const category = normalizeCat(row.Category);
    if (!['MF', 'PMS', 'STOCKS'].includes(category)) continue;
    const familyMemberName = String(row.Family_Member_Name || '123');
    const subCategory = String(row.Sub_Category || 'EQUITY').toUpperCase();
    const key = `${monthKey}|${familyMemberName}|${category}|${subCategory}`;
    const amount = Number(row.Closing_Amount);
    if (!Number.isFinite(amount)) continue;
    const prev = cbAgg.get(key);
    if (prev) {
      prev.closingAmount += amount;
    } else {
      cbAgg.set(key, {
        dateOfEntry,
        userId: String(row.User_Id || 'ProAffluence'),
        monthKey,
        month: monthLabelFromKey(monthKey),
        familyMemberName,
        category,
        subCategory,
        closingAmount: amount,
      });
    }
  }
  const cbData = [...cbAgg.values()].map((row) => ({
    srNo: nextCbSr++,
    dateOfEntry: row.dateOfEntry,
    userId: row.userId,
    monthKey: row.monthKey,
    month: row.month,
    groupHeadId: gh.id,
    groupHeadName: gh.name,
    familyMemberName: row.familyMemberName,
    category: row.category,
    subCategory: row.subCategory,
    closingAmount: new Prisma.Decimal(Number(row.closingAmount.toFixed(2))),
    approvalStatus: ApprovalStatus.APPROVED,
    voided: false,
    submittedById: actorId,
    submittedByName: actorName,
    submittedAt: new Date(),
    approvedById: actorId,
    approvedByName: actorName,
    approvedAt: new Date(),
  }));
  for (let i = 0; i < cbData.length; i += 50) {
    await prisma.closingBalance.createMany({ data: cbData.slice(i, i + 50) });
  }
  console.log(
    `Loaded ${cbData.length} closing balances (from ${closings.length} Excel rows, aggregated)`,
  );

  // Spot-check one live API create (cashflow without Sr_No) to prove portal path
  const spot = await api(cookie, 'POST', '/api/v1/cashflows', {
    Date_Of_Entry: '30-09-2026',
    Group_Head_Name: '123',
    Family_Member_Name: '123',
    Client_Owner: 'ProAffluence Associates Private Limited',
    Transaction_Date: '30-09-2026',
    Transaction_Type: 'Purchase',
    Category: 'MF',
    Sub_Category: 'EQUITY',
    Amounts: 1,
  });
  console.log(
    `API cashflow spot-create: ${spot.status}`,
    spot.ok ? `srNo=${spot.json?.srNo}` : JSON.stringify(spot.json),
  );
  if (spot.ok && spot.json?.id) {
    await api(cookie, 'POST', `/api/v1/cashflows/${spot.json.id}/approve`, {});
    // void the ₹1 noise so it does not skew returns
    await api(cookie, 'POST', `/api/v1/cashflows/${spot.json.id}/void`, {
      reason: 'E2E spot-create cleanup',
    });
  }

  // 4) Pre-flight + calculate
  const pre = await api(
    cookie,
    'GET',
    `/api/v1/reports/pre-flight?period=${encodeURIComponent(PERIOD)}&groupHeadId=123`,
  );
  console.log('Pre-flight', pre.status, JSON.stringify(pre.json)?.slice(0, 400));

  const calc = await api(cookie, 'POST', '/api/v1/reports/calculate', {
    period: PERIOD,
    groupHeadId: '123',
  });
  console.log('Calculate', calc.status, calc.ok ? calc.json?.status : JSON.stringify(calc.json));

  // 5) Annual dashboard vs Excel
  const dash = await api(
    cookie,
    'GET',
    `/api/v1/reports/annual-dashboard?groupHeadId=123&toPeriod=${encodeURIComponent(PERIOD)}`,
  );
  if (!dash.ok) throw new Error(`Dashboard failed: ${dash.status} ${JSON.stringify(dash.json)}`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'dashboard.json'),
    JSON.stringify(dash.json, null, 2),
  );

  const diffs = [];
  const appSummary = dash.json.summary || [];
  for (const exp of expected.summary) {
    const got = appSummary.find((r) => r.financialYear === exp.financialYear);
    if (!got) {
      diffs.push({ area: 'summary', fy: exp.financialYear, field: '*', excel: exp, app: null });
      continue;
    }
    for (const field of ['valueAsOn3103', 'newInvestments', 'xirr']) {
      const e = exp[field];
      const a = got[field];
      // Excel "-" for seed year XIRR → treat as 0
      const eNorm = e === '-' ? 0 : e;
      if (eNorm == null && a == null) continue;
      if (field === 'newInvestments' && exp.financialYear === 'Since Inception') continue;
      if (field === 'valueAsOn3103' && exp.financialYear === 'Since Inception') continue;
      if (field === 'xirr' && String(exp.financialYear).startsWith('Net Investment')) continue;
      if (field === 'valueAsOn3103' && String(exp.financialYear).startsWith('Net Investment')) continue;
      const tol = field === 'xirr' ? 0.05 : field === 'valueAsOn3103' ? 5 : 50;
      if (!nearlyEqual(a, eNorm, tol, 0.002)) {
        diffs.push({
          area: 'summary',
          fy: exp.financialYear,
          field,
          excel: eNorm,
          app: a,
        });
      }
    }
  }

  const appXirr = dash.json.xirr || [];
  for (const exp of expected.xirr) {
    const got = appXirr.find((r) => r.financialYear === exp.financialYear);
    if (!got) {
      diffs.push({ area: 'xirr', fy: exp.financialYear, field: '*', excel: exp, app: null });
      continue;
    }
    for (const field of ['portfolio', 'mf', 'pms', 'stock']) {
      const e = exp[field];
      const a = got[field];
      if (e == null && (a == null || a === 0)) continue;
      if (!nearlyEqual(a, e, 0.05, 0.002)) {
        diffs.push({ area: 'xirr', fy: exp.financialYear, field, excel: e, app: a });
      }
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'diffs.json'), JSON.stringify(diffs, null, 2));
  const matchedSummary = expected.summary.length * 3 - diffs.filter((d) => d.area === 'summary').length;
  const matchedXirr = expected.xirr.length * 4 - diffs.filter((d) => d.area === 'xirr').length;
  console.log(`\nDashboard parity: ${diffs.length} mismatches`);
  console.log(
    `SI portfolio app=${dash.json.portfolioReturns} excel=${expected.summary.find((s) => s.financialYear === 'Since Inception')?.xirr}`,
  );
  console.log(
    `Net Investment app=${appSummary.find((s) => String(s.financialYear).startsWith('Net Investment'))?.newInvestments} excel=${expected.summary.find((s) => String(s.financialYear).startsWith('Net Investment'))?.newInvestments}`,
  );
  console.log('Sample mismatches:', diffs.slice(0, 12));

  // 6) Encrypted PDF
  const pdf = await apiBinary(
    cookie,
    `/api/v1/reports/pdf/123?period=${encodeURIComponent(PERIOD)}&encrypted=true`,
  );
  const pdfPath = path.join(OUT_DIR, 'FY_Annual_Dashboard_123_encrypted.pdf');
  if (pdf.ok) {
    fs.writeFileSync(pdfPath, pdf.buffer);
    console.log(
      `PDF OK ${pdf.status} bytes=${pdf.buffer.length} protected=${pdf.headers.get('x-pdf-password-protected')} pages=${pdf.headers.get('x-pdf-total-pages')} → ${pdfPath}`,
    );
  } else {
    console.error('PDF FAILED', pdf.status, pdf.buffer?.toString?.('utf8')?.slice(0, 400));
  }

  // Unencrypted preview for inspection
  const pdfPlain = await apiBinary(
    cookie,
    `/api/v1/reports/pdf/123?period=${encodeURIComponent(PERIOD)}&encrypted=false`,
  );
  if (pdfPlain.ok) {
    fs.writeFileSync(
      path.join(OUT_DIR, 'FY_Annual_Dashboard_123_plain.pdf'),
      pdfPlain.buffer,
    );
  }

  const report = {
    groupHeadId: gh.id,
    cashflowsLoaded: cfData.length,
    closingsLoaded: cbData.length,
    preflight: pre.json,
    calculate: calc.json,
    portfolioReturns: dash.json.portfolioReturns,
    benchmark: dash.json.benchmark,
    mismatchCount: diffs.length,
    matchedHint: { matchedSummary, matchedXirr },
    pdfEncryptedOk: pdf.ok,
    pdfBytes: pdf.buffer?.length ?? 0,
    outDir: OUT_DIR,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== DONE ===');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
