import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptiveMaxLoss } from '../src/components/history/AdaptiveMaxLoss';

test('MAX LOSS renders only the three independent server maxima, including zero', () => {
  const html = renderToStaticMarkup(createElement(AdaptiveMaxLoss, { data: { test3MaxLoss: 13, test7MaxLoss: 0, test9MaxLoss: 7 } }));
  assert.deepEqual([...html.matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map((match) => match[1]), ['TEST 3', 'TEST 7', 'TEST 9']);
  assert.deepEqual([...html.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((match) => match[1]), ['13', '0', '7']);
  assert.match(html, />MAX LOSS<\/h2>/);
  assert.doesNotMatch(html, /accuracy|total losses|hit streak|hit count|mapping|NO BET/i);
  const pending = renderToStaticMarkup(createElement(AdaptiveMaxLoss, { data: null }));
  assert.deepEqual([...pending.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((match) => match[1]), ['—', '—', '—']);
});

test('the adaptive page shares one compact subscription and places MAX LOSS last, without full-history analysis', () => {
  const page = readFileSync(new URL('../src/pages/AdaptiveLearningPage.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/components/history/AdaptiveLearningPanel.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../src/hooks/useServerAdaptiveLearning.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(page, /<AdaptiveLearningPanel serverState=\{serverState\} \/>/);
  assert.match(page, /<AdaptiveMaxLoss data=\{data\} \/>\s*<\/div>/);
  assert.equal([...page.matchAll(/useServerAdaptiveLearning\(\)/g)].length, 1);
  assert.match(panel, /serverState\s*\? <AdaptiveLearningPanelContent/);
  assert.ok(app.indexOf('path="/adaptive-learning"') < app.indexOf('<RealHistoryProvider>'), 'Adaptive route must remain outside the history-polling providers');
  for (const source of [page, panel, hook]) {
    assert.doesNotMatch(source, /AlgorithmAnalyzer|useAdaptiveLearning\(|useRealHistory|history\?limit=all|\/api\/real\/history|\/api\/real\/t7-signals/);
  }
});
