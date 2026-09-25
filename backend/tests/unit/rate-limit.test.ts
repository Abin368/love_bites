import { evaluateSlidingWindow } from '../../src/utils/rate-limit';

describe('sliding window rate limit', () => {
  it('allows requests inside the limit and blocks the next one until the window moves', () => {
    const first = evaluateSlidingWindow([], 1_000, 60_000, 1, 'a');
    expect(first.allowed).toBe(true);
    const second = evaluateSlidingWindow(first.entries, 2_000, 60_000, 1, 'b');
    expect(second.allowed).toBe(false);
    const later = evaluateSlidingWindow(second.entries, 62_001, 60_000, 1, 'c');
    expect(later.allowed).toBe(true);
  });
});
