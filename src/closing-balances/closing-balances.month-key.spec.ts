import { parseMonthKeyFromLabel } from './month-key.util';

describe('parseMonthKeyFromLabel', () => {
  it.each([
    ['Mar-18', '2018-03'],
    ['Sep-26', '2026-09'],
    ['Sept-26', '2026-09'],
    ['mar 2018', '2018-03'],
    ['March 2018', '2018-03'],
    ['November 2026', '2026-11'],
    ['2018-03', '2018-03'],
    ['03-2018', '2018-03'],
    ['3/2018', '2018-03'],
    ['01-03-2018', '2018-03'],
    ['31/03/2019', '2019-03'],
  ])('%s -> %s', (label, expected) => {
    expect(parseMonthKeyFromLabel(label)).toBe(expected);
  });

  it.each(['', 'foo', 'Marchy-18', '13-2018', '2018-13', '31-02-2018', 'Mar'])(
    'rejects %p',
    (label) => {
      expect(parseMonthKeyFromLabel(label)).toBeNull();
    },
  );
});
