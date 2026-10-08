import { compareHistoryPeriods } from './history-spool.js';

/** Keep only upstream records strictly newer than a reset boundary. */
export function filterHistoryRecordsAfterBoundary(records, boundary, getPeriod = (record) => record.issue_number) {
  if (!boundary) return [...records];
  return records.filter((record) => compareHistoryPeriods(getPeriod(record), boundary) > 0);
}
