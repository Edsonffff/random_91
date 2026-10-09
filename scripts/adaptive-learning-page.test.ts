import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptiveMaxLoss } from '../src/components/history/AdaptiveMaxLoss';
import { AdaptiveLearningPanel } from '../src/components/history/AdaptiveLearningPanel';
import { INITIAL_ADAPTIVE_API_STATE, type VerifiedMaxLoss } from '../src/services/adaptiveLearningApi';

test('Verified Max Loss renders only the independent metric and never falls back to checkpoint counters', () => {
  const html = renderToStaticMarkup(createElement(AdaptiveMaxLoss, { metric: {
    test3: 5, test7: 15, test9: 8, coverage: 'partial', coverageReason: 'historical_gap',
    firstMissingHistoryPeriod: '20261002100052302', lastMissingHistoryPeriod: '20261002100052347',
    knownThrough: '20261002100052301', scopeStartPeriod: '20261002100052078',
    calculatedAt: '2026-10-07T17:00:00.000Z', calculationStatus: 'ready',
  } }));
  assert.deepEqual([...html.matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map((match) => match[1]), ['TEST 3', 'TEST 7', 'TEST 9']);
  assert.deepEqual([...html.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((match) => match[1]), ['5', '15', '8']);
  assert.match(html, />VERIFIED MAX LOSS<\/h2>/);
  assert.match(html, /Independent · Read-only/);
  assert.match(html, /Coverage: <strong[^>]*>Partial<\/strong>/);
  assert.match(html, /historical input is unavailable/i);
  assert.doesNotMatch(html, /accuracy|total losses|hit streak|hit count|mapping|NO BET/i);
  const pending = renderToStaticMarkup(createElement(AdaptiveMaxLoss, {}));
  assert.deepEqual([...pending.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((match) => match[1]), ['—', '—', '—']);
  assert.match(pending, /unavailable until the independent read-only calculation/i);
});

test('the adaptive page shares one compact subscription and places MAX LOSS last, without full-history analysis', () => {
  const page = readFileSync(new URL('../src/pages/AdaptiveLearningPage.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/components/history/AdaptiveLearningPanel.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../src/hooks/useServerAdaptiveLearning.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(page, /<AdaptiveLearningPanel serverState=\{serverState\} \/>/);
  assert.match(page, /<AdaptiveMaxLoss metric=\{serverState.maxLoss\} \/>\s*<\/div>/);
  assert.equal([...page.matchAll(/useServerAdaptiveLearning\(\)/g)].length, 1);
  assert.match(panel, /serverState\s*\? <AdaptiveLearningPanelContent/);
  assert.ok(app.indexOf('path="/adaptive-learning"') < app.indexOf('<RealHistoryProvider>'), 'Adaptive route must remain outside the history-polling providers');
  for (const source of [page, panel, hook]) {
    assert.doesNotMatch(source, /AlgorithmAnalyzer|useAdaptiveLearning\(|useRealHistory|history\?limit=all|\/api\/real\/history|\/api\/real\/t7-signals/);
  }
});

test('waiting Adaptive and independently verified 5/15/8 Max Loss render separately with historical-gap coverage', () => {
  const metric: VerifiedMaxLoss = {
    test3: 5, test7: 15, test9: 8, coverage: 'partial', coverageReason: 'historical_gap',
    firstMissingHistoryPeriod: '20261002100052302', lastMissingHistoryPeriod: '20261002100052347',
    knownThrough: '20261002100052220', scopeStartPeriod: '20261002100052078',
    calculatedAt: '2026-10-07T17:00:00.000Z', calculationStatus: 'ready',
  };
  const panel = renderToStaticMarkup(createElement(AdaptiveLearningPanel, { serverState: {
    ...INITIAL_ADAPTIVE_API_STATE, status: 'PENDING_RESULT', pendingPeriod: '20261002100052220', maxLoss: metric,
  } }));
  assert.match(panel, /Waiting for finalized actual result/);
  assert.match(panel, /Waiting for finalized actual result/);
  assert.match(panel, /Historical input is unavailable/);
  assert.match(panel, /Verified Max Loss is an independent read-only metric/);
  assert.match(panel, /Historical gap: 20261002100052302 → 20261002100052347/);
  assert.match(panel, /20261002100052220/);
  const html = renderToStaticMarkup(createElement(AdaptiveMaxLoss, { metric }));
  assert.deepEqual([...html.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((match) => match[1]), ['5', '15', '8']);
  assert.match(html, /Coverage: <strong[^>]*>Partial<\/strong>/);
  assert.match(html, /not a global or all-time verification claim/);
  assert.match(html, /20261002100052302/);
  assert.match(html, /20261002100052347/);
  assert.doesNotMatch(panel + html, /unavailable until evaluation catches up|All-time Max Loss fully verified/i);
});
