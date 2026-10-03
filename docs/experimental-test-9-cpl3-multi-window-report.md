# CPL-3 Multi-Window Out-of-Sample Report

This report evaluates the existing frozen CPL-3 configuration without changing
its logic:

```text
context-8-cap-3
```

No configuration selection or tuning occurs in these windows. Each date uses
four expanding-prefix test windows:

- 40% train → next 10% test
- 50% train → next 10% test
- 60% train → next 10% test
- 70% train → remaining test records

The model updates after each settled test row, but never uses a future row
before that row is evaluated. Dates are evaluated independently. CPL-3 must
have the same NO_SIGNAL count as CPL-1 in every window.

## Per-window longest loss streak

| Window | Train | Test | Baseline | CPL-1 | CPL-3 | CPL-3 coverage |
|---|---:|---:|---:|---:|---:|---:|
| 20261002-W1 | 492 | 123 | 7 | 5 | 4 | 100% |
| 20261002-W2 | 615 | 123 | 5 | 9 | 4 | 100% |
| 20261002-W3 | 738 | 123 | 5 | 5 | 5 | 100% |
| 20261002-W4 | 861 | 369 | 6 | 8 | 7 | 100% |
| 20261003-W1 | 292 | 74 | 6 | 6 | 4 | 100% |
| 20261003-W2 | 366 | 73 | 4 | 4 | 5 | 100% |
| 20261003-W3 | 439 | 73 | 7 | 5 | 7 | 100% |
| 20261003-W4 | 512 | 220 | 9 | 10 | 5 | 100% |

CPL-3 beats baseline on longest loss streak in **4 of 8** windows and beats
CPL-1 in **5 of 8** windows. It ties baseline twice and CPL-1 once.

## Aggregate multi-window metrics

| Model | Coverage | Avg longest loss streak | Worst longest loss streak | Avg loss streak length | Total loss episodes | Max drawdown | Avg max drawdown |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 100% | 6.125 | 9 | 1.980 | 292 | 25 | 13.625 |
| CPL-1 | 100% | 6.500 | 10 | 2.069 | 281 | 29 | 13.625 |
| CPL-3 | 100% | 5.125 | 7 | 1.948 | 294 | 20 | 10.750 |

Informational only, not optimization targets:

| Model | Wins | Losses | Accuracy |
|---|---:|---:|---:|
| Baseline | 588 | 590 | 49.92% |
| CPL-1 | 606 | 572 | 51.44% |
| CPL-3 | 613 | 565 | 52.04% |

## Conclusion

CPL-3 does **not consistently reduce the longest loss streak** out of sample:
it wins fewer than all windows against either comparator. It does show a lower
average longest streak and lower worst observed streak across these eight
windows, with 100% coverage. It also has more total loss-streak episodes than
both baseline and CPL-1, so the result is mixed rather than a universal
loss-streak improvement.

The windows are historical and some records were examined in earlier Test 9
research; this is not a pristine prospective trial. Accuracy is included only
as context and was not used to select or declare success.
