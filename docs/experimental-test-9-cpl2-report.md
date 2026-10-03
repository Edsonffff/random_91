# Test 9 — CPL-2 Confidence Gate

CPL-2 is a separate policy layer around the unchanged CPL-1 probability
output. CPL-1 still performs all feature generation, training, and probability
calculation.

For each fixed threshold `t`:

- `probabilityBig >= t` → `BIG`
- `probabilityBig <= 1 - t` → `SMALL`
- otherwise → `NO_SIGNAL`

Thresholds tested: `0.52`, `0.54`, `0.56`, `0.58`, and `0.60`.

Threshold selection is performed on validation data only. The selected threshold
is then frozen before the holdout is evaluated. The selection order is:

1. Validation coverage at least 80%
2. Fewest loss-streak episodes
3. Shortest longest loss streak
4. Shortest average loss streak
5. Lowest maximum drawdown
6. Accuracy as a secondary metric

`NO_SIGNAL` does not count as a loss and breaks a loss streak. A missing issue
sequence or date boundary also resets the sequence accounting.

Run the current report with:

```bash
npm run backtest:t9
```

The command prints every threshold's validation metrics, the selected frozen
threshold, and the one-time holdout result. It compares the baseline, CPL-1,
and CPL-2 metrics. A lower holdout loss-streak count is not evidence that the
underlying random outcome is predictable.

## Latest verified run

The latest run used 1,840 records, split independently by date:

- `20261002`: 492 train / 492 validation / 246 holdout
- `20261003`: 244 train / 244 validation / 122 holdout

No threshold met the required 80% validation coverage, so CPL-2 was rejected
and the holdout was not evaluated. This is intentional: the protocol does not
relax coverage or select a threshold from holdout results.

| Threshold | Validation coverage | Wins | Losses | Accuracy | Loss episodes | Avg loss streak | Longest loss streak | Max drawdown | NO_SIGNAL |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.52 | 73.10% | 267 | 271 | 49.63% | 184 | 1.47 | 5 | 18 | 198 |
| 0.54 | 49.05% | 177 | 184 | 49.03% | 154 | 1.19 | 3 | 21 | 375 |
| 0.56 | 27.17% | 90 | 110 | 45.00% | 105 | 1.05 | 2 | 23 | 536 |
| 0.58 | 15.08% | 50 | 61 | 45.05% | 60 | 1.02 | 2 | 17 | 625 |
| 0.60 | 7.07% | 24 | 28 | 46.15% | 28 | 1.00 | 1 | 12 | 684 |

Because no threshold reached 80%, there is no selected threshold and no CPL-2
holdout result. The corresponding validation comparison was:

| Model | Coverage | Wins | Losses | Accuracy | Loss episodes | Avg loss streak | Longest loss streak | Max drawdown | NO_SIGNAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 100.00% | 380 | 356 | 51.63% | 187 | 1.90 | 7 | 20 | 0 |
| CPL-1 | 100.00% | 370 | 366 | 50.27% | 180 | 2.03 | 9 | 23 | 0 |

The holdout comparison was run for the unchanged baseline and CPL-1 only,
because CPL-2 had no valid frozen threshold:

| Model | Coverage | Wins | Losses | Accuracy | Loss episodes | Avg loss streak | Longest loss streak | Max drawdown | NO_SIGNAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 100.00% | 176 | 192 | 47.83% | 88 | 2.18 | 9 | 21 | 0 |
| CPL-1 | 100.00% | 195 | 173 | 52.99% | 85 | 2.04 | 10 | 29 | 0 |

Therefore CPL-2 has no verified holdout improvement in this run. It cannot be
called a loss-streak improvement until a threshold passes the coverage rule in
validation and is then evaluated once on holdout.
