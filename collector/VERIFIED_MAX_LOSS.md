# Independent verified Max Loss

`GET /api/adaptive-learning/current` retains its Adaptive response and adds a
separate `maxLoss` object. A response may have `success: false` and
`status: waiting_for_t7` while containing usable independent metrics.

The metric worker only reads the active baseline metadata, durable history,
and stored T7 predictions. It never starts an Adaptive engine, changes its
weights, finalizes provider rows, or writes checkpoints/data. No migration is
required. Collector/provider polling schedules are unchanged.

## Scoring and continuity

- Test 3 reuses `computeTest3` on the established chronological prefix. After
  a history hole, its round ordinal is unknown; later rows are not scored with
  a compressed or restarted sequence.
- Test 7 reuses `computeTest7` for each exact stored prediction/result pair.
  Provider settlement metadata is not required for statistical scoring. A
  missing/invalid prediction is UNKNOWN; it is never a guessed hit or loss.
- Test 9 reuses `predictExperimentalPeriod` and `advanceCpl3` with the frozen
  `context-8-cap-3` policy and original availability rules. A history hole can
  invalidate same-date context. Such rows are UNKNOWN; context can be
  re-established at a subsequent date with its first round present. The metric
  does not fit a simplified replacement model against incomplete context.
- LOSS extends the current verified run. WIN, UNKNOWN, NO_SIGNAL, and a
  missing-history boundary reset it. No run bridges an unknown interval.
- `longestLossStreak` only increases. Record start/end periods are returned
  with each test as supporting evidence. Cached refresh/progress responses
  retain already-known records rather than temporarily lowering them.

The scope starts at the existing baseline's start, without changing that
baseline. `coverage: partial` includes baseline scope, unknown predictions or
context, and detected history gaps. These are known verified records within
available history, not a claim of fully verified global all-time coverage.

## Response and display

`maxLoss.test3/test7/test9` contain the known records. Per-test `tests` include
current and longest loss streaks, scored/unknown counts, known-through period,
and record start/end evidence. Top-level metadata includes scope, calculation
time/status, coverage reasons, and exact missing-history ranges/counts.

The worker recomputes the verified checkpoint prefix first, then the remaining
durable metric inputs. Heavy prediction calculations run outside the HTTP and
collector event loop. Refreshes are coalesced and throttled to 30 seconds on
the existing compact endpoint requests; no new provider polling is added.
Private CPL results are cached by same-date input-prefix digest, including
history availability timestamps. Changing that prefix invalidates the cache.

The frontend uses one existing compact subscription. It presents Adaptive
waiting separately from Max Loss and explicitly marks partial coverage.

The captured regression fixture through `20261002100052220` remains 5/5/6.
Test 7 SMALL against historical number 6 is LOSS, changes the current run from
0 to 1, and keeps its record at 5. Subsequent verified runs may establish
larger records independently without advancing Adaptive replay.
