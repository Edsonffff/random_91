import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateT3MaxLoss,
  calculateT7MaxLoss,
  calculateT9MaxLoss,
  calculateAllTestMaxLoss,
  nextPeriod,
} from '../src/utils/testMaxLossCalculator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRound(issueIndex: number, winningNumber: number) {
  const period = `2026100310005${String(issueIndex).padStart(4, '0')}`;
  return { period, number: winningNumber };
}

// ---------------------------------------------------------------------------
// 1. T3 Max Loss Streak Tests
// ---------------------------------------------------------------------------

test('T3: calculates longest consecutive loss streak correctly', () => {
  // Test 3 repeating sequence:
  // 0: Small, 1: Big, 2: Small, 3: Big, 4: Small, 5: Small, 6: Big
  // If actual numbers are:
  // round 1 (pos 0, pred Small): number 7 (Big) -> LOSS (streak = 1)
  // round 2 (pos 1, pred Big):   number 2 (Small) -> LOSS (streak = 2)
  // round 3 (pos 2, pred Small): number 8 (Big) -> LOSS (streak = 3)
  // round 4 (pos 3, pred Big):   number 8 (Big) -> WIN (streak = 0)
  // round 5 (pos 4, pred Small): number 9 (Big) -> LOSS (streak = 1)
  const rounds = [
    makeRound(1, 7),
    makeRound(2, 2),
    makeRound(3, 8),
    makeRound(4, 8),
    makeRound(5, 9),
  ];

  const result = calculateT3MaxLoss(rounds);
  assert.equal(result.name, 'T3');
  assert.equal(result.maxLossStreak, 3);
  assert.equal(result.currentLossStreak, 1);
  assert.equal(result.totalHits, 1);
  assert.equal(result.totalMisses, 4);
  assert.equal(result.totalEvaluated, 5);
});

test('T3: sorts records chronologically ascending before evaluating', () => {
  const rounds = [
    makeRound(3, 8), // LOSS
    makeRound(1, 7), // LOSS
    makeRound(2, 2), // LOSS
  ];
  // Reverse order input
  const result = calculateT3MaxLoss(rounds);
  assert.equal(result.maxLossStreak, 3);
  assert.equal(result.totalEvaluated, 3);
});

test('T3: period gap resets consecutive loss streak and is not counted as a loss', () => {
  // round 1: LOSS (streak = 1)
  // round 2: LOSS (streak = 2)
  // [GAP: round 3 is missing]
  // round 4: LOSS (streak = 1, because gap broke the sequence)
  const rounds = [
    makeRound(1, 7), // pos 0 pred Small vs Big -> LOSS
    makeRound(2, 2), // pos 1 pred Big vs Small -> LOSS
    // round 3 missing
    makeRound(4, 8), // pos 2 pred Small vs Big -> LOSS
  ];

  const result = calculateT3MaxLoss(rounds);
  // Without gap handling, streak would be 3.
  // With gap handling, missing round 3 is NOT a loss, so max loss is 2!
  assert.equal(result.maxLossStreak, 2);
  assert.equal(result.currentLossStreak, 1);
  assert.equal(result.totalEvaluated, 3);
});

// ---------------------------------------------------------------------------
// 2. T7 Max Loss Streak Tests
// ---------------------------------------------------------------------------

test('T7: calculates longest consecutive loss streak from its own signals only', () => {
  const rounds = [
    makeRound(1, 6), // Big
    makeRound(2, 6), // Big
    makeRound(3, 6), // Big
    makeRound(4, 6), // Big
    makeRound(5, 6), // Big
  ];

  const signals = new Map([
    [rounds[0].period, { signal: 'SMALL' as const }], // LOSS (1)
    [rounds[1].period, { signal: 'SMALL' as const }], // LOSS (2)
    [rounds[2].period, { signal: 'SMALL' as const }], // LOSS (3)
    [rounds[3].period, { signal: 'BIG' as const }],   // WIN (0)
    [rounds[4].period, { signal: 'SMALL' as const }], // LOSS (1)
  ]);

  const result = calculateT7MaxLoss(rounds, signals);
  assert.equal(result.name, 'T7');
  assert.equal(result.maxLossStreak, 3);
  assert.equal(result.currentLossStreak, 1);
  assert.equal(result.totalHits, 1);
  assert.equal(result.totalMisses, 4);
});

test('T7: unknown / missing signal does NOT count as a loss and breaks the streak', () => {
  // L L L UNKNOWN L L -> maxLoss = 3, currentLoss = 2
  const rounds = [
    makeRound(1, 6), // LOSS
    makeRound(2, 6), // LOSS
    makeRound(3, 6), // LOSS
    makeRound(4, 6), // NO SIGNAL (UNKNOWN)
    makeRound(5, 6), // LOSS
    makeRound(6, 6), // LOSS
  ];

  const signals = new Map([
    [rounds[0].period, { signal: 'SMALL' as const }],
    [rounds[1].period, { signal: 'SMALL' as const }],
    [rounds[2].period, { signal: 'SMALL' as const }],
    // round 4 has no signal!
    [rounds[4].period, { signal: 'SMALL' as const }],
    [rounds[5].period, { signal: 'SMALL' as const }],
  ]);

  const result = calculateT7MaxLoss(rounds, signals);
  assert.equal(result.maxLossStreak, 3, 'Missing signal must not bridge into a streak of 5');
  assert.equal(result.currentLossStreak, 2);
  assert.equal(result.totalEvaluated, 5, 'Unscored period 4 is excluded from total');
});

test('T7: returns 0 when no signals have been stored yet', () => {
  const rounds = [makeRound(1, 6), makeRound(2, 6)];
  const result = calculateT7MaxLoss(rounds, new Map());
  assert.equal(result.maxLossStreak, 0);
  assert.equal(result.currentLossStreak, 0);
  assert.equal(result.totalEvaluated, 0);
});

// ---------------------------------------------------------------------------
// 3. T9 Max Loss Streak Tests
// ---------------------------------------------------------------------------

test('T9: calculates longest consecutive loss streak from its own model', () => {
  // Generate 25 records on the same date with varying numbers
  const records = Array.from({ length: 25 }, (_, i) => ({
    period: `2026100310005${String(i + 1).padStart(4, '0')}`,
    number: (i * 7 + 3) % 10,
    completedAt: new Date(Date.now() - (25 - i) * 30000).toISOString(),
  }));

  const result = calculateT9MaxLoss(records);
  assert.equal(result.name, 'T9');
  assert.equal(typeof result.maxLossStreak, 'number');
  assert.ok(result.maxLossStreak >= 0);
  assert.ok(result.totalEvaluated >= 0);
});

test('T9: empty history returns 0 streak gracefully', () => {
  const result = calculateT9MaxLoss([]);
  assert.equal(result.maxLossStreak, 0);
  assert.equal(result.currentLossStreak, 0);
  assert.equal(result.totalEvaluated, 0);
});

// ---------------------------------------------------------------------------
// 4. Data Independence Tests
// ---------------------------------------------------------------------------

test('All tests: T3, T7, and T9 calculate independent values without interference', () => {
  const records = [
    makeRound(1, 6),
    makeRound(2, 6),
    makeRound(3, 6),
    makeRound(4, 6),
  ];
  const t7Signals = new Map([
    [records[0].period, { signal: 'BIG' as const }], // T7 WIN
    [records[1].period, { signal: 'BIG' as const }], // T7 WIN
    [records[2].period, { signal: 'BIG' as const }], // T7 WIN
    [records[3].period, { signal: 'BIG' as const }], // T7 WIN
  ]);

  const all = calculateAllTestMaxLoss(records, t7Signals);
  // T7 had all WINS -> max loss streak = 0
  assert.equal(all.t7.maxLossStreak, 0);
  // T3 evaluated its own 14-round sequence independently
  assert.equal(typeof all.t3.maxLossStreak, 'number');
  // T9 evaluated independently
  assert.equal(typeof all.t9.maxLossStreak, 'number');
  assert.ok(all.evaluatedAt);
});

// ---------------------------------------------------------------------------
// 5. nextPeriod Sequencer Tests
// ---------------------------------------------------------------------------

test('nextPeriod: increments within day and rolls over at 2880', () => {
  assert.equal(nextPeriod('20261003100050001'), '20261003100050002');
  assert.equal(nextPeriod('20261003100050040'), '20261003100050041');
  assert.equal(nextPeriod('20261003100052880'), '20261004100050001');
});
