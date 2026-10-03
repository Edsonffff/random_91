# Test 9 — CPL-3 Loss-Streak Breaker

CPL-3 is a separate policy layer over the unchanged CPL-1 output. It does not
modify CPL-1 features, training, or probabilities. It continues to predict
BIG/SMALL whenever CPL-1 has a prediction and therefore cannot improve its
loss-streak metrics by adding extra NO_SIGNAL results.

For each period, CPL-3 uses only information available before that period:

- CPL-1's current BIG/SMALL probability and base prediction
- the prior CPL-3 loss streak length
- the previous settled outcome size
- expanding same-date context counts from earlier periods

The predeclared validation candidates were:

| Configuration | Minimum context support | Loss streak cap |
|---|---:|---:|
| `context-1-cap-2` | 1 | 2 |
| `context-3-cap-2` | 3 | 2 |
| `context-5-cap-3` | 5 | 3 |
| `context-8-cap-3` | 8 | 3 |

Selection objective:

1. Coverage must be at least 80%.
2. Minimize longest loss streak.
3. Minimize loss-streak episode count.
4. Minimize average loss-streak length.
5. Minimize maximum drawdown.

Wins and accuracy are reported only as information and are not selection
objectives.

## Latest verified run

Command:

```bash
npm run backtest:t9
```

Dataset: **1,917 records**, split independently by date:

- `20261002`: 492 train / 492 validation / 246 holdout
- `20261003`: 274 train / 275 validation / 138 holdout

### Validation candidate results

| Configuration | Coverage | Wins | Losses | Accuracy | Loss episodes | Avg loss streak | Longest loss streak | Max drawdown | NO_SIGNAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `context-1-cap-2` | 100.00% | 388 | 379 | 50.59% | 185 | 2.05 | 9 | 27 | 0 |
| `context-3-cap-2` | 100.00% | 376 | 391 | 49.02% | 183 | 2.14 | 11 | 50 | 0 |
| `context-5-cap-3` | 100.00% | 378 | 389 | 49.28% | 193 | 2.02 | 10 | 36 | 0 |
| `context-8-cap-3` | 100.00% | 413 | 354 | 53.85% | 189 | 1.87 | 7 | 13 | 0 |

The selected and frozen configuration was:

```text
context-8-cap-3
```

### Validation comparison

| Model | Coverage | Wins | Losses | Accuracy | Loss episodes | Avg loss streak | Longest loss streak | Max drawdown | NO_SIGNAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 100.00% | 393 | 374 | 51.24% | 191 | 1.96 | 7 | 20 | 0 |
| CPL-1 | 100.00% | 382 | 385 | 49.80% | 188 | 2.05 | 9 | 23 | 0 |
| CPL-3 | 100.00% | 413 | 354 | 53.85% | 189 | 1.87 | 7 | 13 | 0 |

### Frozen holdout comparison

The frozen configuration was evaluated once on the untouched holdout.

| Model | Coverage | Wins | Losses | Accuracy | Loss episodes | Avg loss streak | Longest loss streak | Max drawdown | NO_SIGNAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 100.00% | 186 | 198 | 48.44% | 96 | 2.06 | 9 | 21 | 0 |
| CPL-1 | 100.00% | 202 | 182 | 52.60% | 90 | 2.02 | 8 | 29 | 0 |
| CPL-3 | 100.00% | 187 | 197 | 48.70% | 98 | 2.01 | 7 | 15 | 0 |

## Interpretation

CPL-3 reduced the primary holdout metric, longest loss streak, from **8 to 7**
versus CPL-1 and from **9 to 7** versus baseline, while maintaining 100%
coverage and zero additional NO_SIGNAL results. It also reduced average loss
streak length and maximum drawdown.

However, it increased the number of separate loss-streak episodes versus both
CPL-1 and baseline: **98 versus 90 and 96**. Therefore the result is a partial
improvement of the stated lexicographic objective, not a universal improvement
across every loss-streak metric. Accuracy is lower than CPL-1 and is not being
used to claim success.

The holdout is historical and parts of this dataset were examined in earlier
experiments, so this is not a pristine prospective trial. The result does not
show that random outcomes can be predicted with certainty.
