/**
 * Development-only Period Generator.
 * Standard format: YYYYMMDD + sequence (e.g., 20260928100050374)
 */

export function getCurrentDatePrefix(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Increment a numeric period string safely using BigInt to prevent precision loss.
 */
export function incrementPeriodString(periodStr: string): string {
  const cleaned = periodStr.trim();
  if (!/^\d+$/.test(cleaned)) {
    // Fallback: build default period based on today
    return `${getCurrentDatePrefix()}100050374`;
  }

  try {
    const currentBig = BigInt(cleaned);
    const nextBig = currentBig + 1n;
    return nextBig.toString();
  } catch {
    return `${getCurrentDatePrefix()}100050374`;
  }
}

/**
 * Generates the next unique period number that does not collide with existing test records.
 */
export function generateNextUniquePeriod(
  existingPeriodNumbers: string[],
  basePeriod?: string
): string {
  let candidate: string;

  if (basePeriod && /^\d+$/.test(basePeriod)) {
    candidate = incrementPeriodString(basePeriod);
  } else if (existingPeriodNumbers.length > 0) {
    // Find maximum numeric period among existing
    try {
      const validPeriods = existingPeriodNumbers.filter((p) => /^\d+$/.test(p));
      if (validPeriods.length > 0) {
        let maxVal = BigInt(validPeriods[0]);
        for (const p of validPeriods) {
          const val = BigInt(p);
          if (val > maxVal) {
            maxVal = val;
          }
        }
        candidate = (maxVal + 1n).toString();
      } else {
        candidate = `${getCurrentDatePrefix()}100050374`;
      }
    } catch {
      candidate = `${getCurrentDatePrefix()}100050374`;
    }
  } else {
    candidate = `${getCurrentDatePrefix()}100050374`;
  }

  // Ensure candidate is truly unique
  const set = new Set(existingPeriodNumbers);
  while (set.has(candidate)) {
    candidate = incrementPeriodString(candidate);
  }

  return candidate;
}
