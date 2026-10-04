// Build-time only: extract existing browser calculations without editing src/.
// The phone runs the generated plain ESM and needs no TypeScript/React runtime.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const sources = new Map();
function source(path) {
  const text = readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
  sources.set(path, text);
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const analyzer = source('src/components/history/AlgorithmAnalyzer.tsx');
const signals = source('src/components/history/AdditionalSignalsPanel.tsx');
const hook = source('src/hooks/useAdaptiveLearning.ts');
const context = source('src/context/RealHistoryContext.tsx');
const periodic = source('src/experimental/periodicLogisticAlgorithm.ts');
const cpl3 = source('src/experimental/cpl3LossStreakBreaker.ts');

function named(tree, name) {
  let found;
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(tree) === name) {
      if (found) throw new Error(`Ambiguous source declaration: ${name}`);
      found = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!found) throw new Error(`Missing source declaration: ${name}`);
  return found;
}
function declarations(tree, names) {
  return names.map((name) => {
    const node = named(tree, name);
    return ts.isVariableDeclaration(node) ? `const ${node.getText(tree)};` : node.getText(tree).replace(/^export /, '');
  }).join('\n');
}
function memoBody(tree, name) {
  const node = named(tree, name);
  const callback = node.initializer?.arguments?.[0];
  if (!callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) {
    throw new Error(`Expected block memo: ${name}`);
  }
  return callback.body;
}
function bodyText(body, tree) { return body.statements.map((s) => s.getText(tree)).join('\n'); }
function loop(body, tree) {
  const loops = body.statements.filter(ts.isForOfStatement);
  if (loops.length !== 1) throw new Error('Source loop structure changed; inspect before regenerating.');
  return loops[0].getText(tree);
}

const adaptiveBody = memoBody(hook, 'result');
const cplBody = named(cpl3, 'runCpl3WalkForward').body;
const code = [
  declarations(context, ['compareIssuesDesc', 'compareIssuesAsc']),
  declarations(analyzer, ['WINGOBOT_T3_PATTERN_MAP', 'WINGOBOT_T3_CONFLICTING_PAIRS']),
  `function computeTest3(activeDataset) { ${bodyText(memoBody(analyzer, 'test3'), analyzer)} }`,
  declarations(signals, ['toBigSmall', 'streakStats', 'sortedAscending', 'computeTest7']),
  periodic.getText(periodic),
  declarations(cpl3, ['CPL3_CONFIGS', 'sizeOfPrediction', 'sequenceBreak', 'contextKey', 'updateStats', 'total', 'contextCandidates', 'choosePrediction', 'runCpl3WalkForward']),
  // Only the loop's lifetime changes. Its prediction/settlement statements are verbatim.
  `function advanceCpl3(rows, state, config) {
    const sorted = [...rows].sort((a, b) => compareIssueNumbers(a.periodId, b.periodId));
    const stats = new Map(state.stats.map(([key, value]) => [key, { ...value }]));
    const output = [];
    let previous = state.previous;
    let priorLossStreak = state.priorLossStreak;
    let previousActual = state.previousActual;
    ${loop(cplBody, cpl3)}
    return { rows: output, state: { stats: [...stats], previous, priorLossStreak, previousActual } };
  }`,
  declarations(hook, ['LEARNING_RATE', 'N_SIGNALS', 'INITIAL_WEIGHT', 'MIN_WEIGHT', 'STORAGE_KEY', 'LEGACY_STORAGE_KEY', 'ACTIVE_PREDICTION_KEY', 'ACTIVE_PREDICTION_MAX', 'SIGNAL_LABELS', 'normaliseWeights', 'clamp', 'freshWeights', 'saveModel', 'persistActivePrediction', 'computeStreaks', 'rollingWindow', 'rowPredictions', 'computeVote']),
  `function advanceAdaptive(ascending, weights) {
    let ws = [...weights];
    const history = [];
    ${loop(adaptiveBody, hook)}
    return { history, weights: ws };
  }`,
  `function replayBrowser(inputs, activeInput, modelState = { weights: freshWeights(), processedPeriods: [] }) {
    ${bodyText(adaptiveBody, hook)}
  }`,
  `function browserT9Active(realSchedule, test9History, test9Cpl1Rows) {
    ${bodyText(memoBody(analyzer, 'test9ActiveRow'), analyzer)}
  }`,
  `function browserAdaptiveInputs(activeDataset, test3, test7, test9Rows) {
    ${bodyText(memoBody(analyzer, 'adaptiveInputs'), analyzer)}
  }`,
  `function browserActiveInput(activePeriodId, test3, test7, test9ActiveRow) {
    ${bodyText(memoBody(analyzer, 'adaptiveActiveInput'), analyzer)}
  }`,
  'export { compareIssuesAsc, computeTest3, computeTest7, CPL3_CONFIGS, runCpl3WalkForward, advanceCpl3, advanceAdaptive, freshWeights, computeVote, rowPredictions, computeStreaks, rollingWindow, SIGNAL_LABELS, replayBrowser, browserT9Active, browserAdaptiveInputs, browserActiveInput };',
].join('\n\n');
const fingerprint = createHash('sha256').update(JSON.stringify([...sources])).digest('hex');
const output = `// GENERATED by collector/build-adaptive-algorithms.mjs. Do not hand edit.\n// Source SHA-256: ${fingerprint}\nexport const SOURCE_FINGERPRINT = '${fingerprint}';\n` + ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const destination = new URL('./adaptive-algorithms.generated.js', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) throw new Error('Generated algorithms differ from current browser sources.');
  console.log('Browser source extraction verified.');
} else {
  writeFileSync(destination, output);
  console.log(`Generated ${fileURLToPath(destination)}`);
}
