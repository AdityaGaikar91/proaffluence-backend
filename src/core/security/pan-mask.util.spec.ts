import { maskPan } from './pan-mask.util';

describe('maskPan', () => {
  it('masks all but last 4 of a 10-char PAN', () => {
    expect(maskPan('ABCDE1234F')).toBe('******234F');
  });

  it('handles short values', () => {
    expect(maskPan('AB')).toBe('****');
  });
});
