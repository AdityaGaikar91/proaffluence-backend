const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isRealDate(day: number, month: number, year: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12) return false;
  const maxDays = new Date(year, month, 0).getDate();
  return day >= 1 && day <= maxDays;
}

/**
 * Parse a reporting-month label into a YYYY-MM monthKey.
 * Accepts "Mar-18", "Mar-2018", "Mar 18", "Sept-26", "March 2018", "2018-03",
 * "03-2018", "03/2018" and full dates "dd-MM-yyyy" / "dd/MM/yyyy".
 * Two-digit years are read as 20YY. Returns null when the label is not a month.
 */
export function parseMonthKeyFromLabel(label: string): string | null {
  if (!label || typeof label !== 'string') return null;
  const text = label.trim();
  if (!text) return null;

  if (MONTH_KEY_RE.test(text)) return text;

  const fullDate = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (fullDate) {
    const [day, month, year] = fullDate.slice(1).map((v) => parseInt(v, 10));
    if (!isRealDate(day, month, year)) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  const numeric = text.match(/^(\d{1,2})[-/](\d{4})$/);
  if (numeric) {
    const key = `${numeric[2]}-${numeric[1].padStart(2, '0')}`;
    return MONTH_KEY_RE.test(key) ? key : null;
  }

  const named = text.match(/^([A-Za-z]+)[\s\-/']*(\d{2}|\d{4})$/);
  if (named) {
    const name = named[1].toLowerCase();
    let monthIdx = MONTH_NAMES.indexOf(name);
    if (monthIdx < 0 && (name.length === 3 || name === 'sept')) {
      monthIdx = MONTH_NAMES.findIndex((m) => m.startsWith(name.slice(0, 3)));
    }
    if (monthIdx < 0) return null;
    const year = named[2].length === 2 ? `20${named[2]}` : named[2];
    const key = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    return MONTH_KEY_RE.test(key) ? key : null;
  }

  return null;
}
