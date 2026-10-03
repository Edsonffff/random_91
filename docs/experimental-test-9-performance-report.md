# Experimental Test 9 — CPL-1 Performance Report

This report describes the separate **Chronological Periodic Logistic (CPL-1)**
experiment. It does not use the other UI test signals.

## Reproduce

```bash
npm run backtest:t9
```

The script retrieves all `WinGo_30S` rows from Supabase in numeric issue order.
It resets model state at each issue date and only trains on same-date records
whose recorded availability is before the target period's scheduled start.

## Algorithm

- Features: sine/cosine encodings of the target issue position modulo 2, 3, 5,
  10, and 60.
- Model: deterministic regularized logistic regression.
- Minimum history: 20 same-date available records.
- Fixed version: `CPL-1`.
- No stake sizing, martingale, or loss recovery logic.

The exact feature names and numeric values are saved with every stored
prediction in `public.wingo_t9_periodic_predictions`.

## Current Supabase snapshot

The values below were generated from the current snapshot during implementation;
rerunning the command is authoritative because the collector may add rows.

| Measure | Value |
|---|---:|
| Historical records | 1,565 |
| Dates | 2 |
| Algorithm predictions | 1,523 |
| Algorithm wins | 777 |
| Algorithm losses | 746 |
| Algorithm accuracy | 51.02% |
| Algorithm longest win streak | 11 |
| Algorithm longest loss streak | 11 |
| Algorithm maximum drawdown | 29 units |

## Walk-forward comparison

The validation block is the middle 40% of each date after the initial 40%
training portion. The holdout block is the final 20% of each date. Each block
is chronological and is never used to fit its own prediction.

| Block | Model | Predictions | Wins | Losses | Accuracy | Longest W | Longest L | Max drawdown |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| All | CPL-1 | 1,523 | 777 | 746 | 51.02% | 11 | 11 | 29 |
| All | Baseline | 1,544 | 759 | 785 | 49.16% | 15 | 12 | 53 |
| Validation | CPL-1 | 626 | 318 | 308 | 50.80% | 10 | 9 | 13 |
| Validation | Baseline | 626 | 333 | 293 | 53.19% | 15 | 7 | 14 |
| Holdout | CPL-1 | 313 | 157 | 156 | 50.16% | 7 | 8 | 29 |
| Holdout | Baseline | 313 | 150 | 163 | 47.92% | 7 | 6 | 21 |

The baseline is an expanding same-date majority rule with Laplace smoothing.
The backtest prints its complete total/win/loss/streak/drawdown metrics for both
models on every run. The apparent periodic effect did not remain consistently
above the baseline across validation and holdout, so this module is not a
claim of predictive power.

## Limitations

The history covers only two dates and contains collection gaps on one date.
Observed differences are compatible with random variation and may reflect
collection/session artifacts. A future update can reverse the result. This
experiment is for transparent measurement only; random outcomes cannot be
predicted with certainty.
