import { scheduledStartFromIssue } from '../adaptive-algorithms.generated.js';

// Read-only capture of durable 52078–52220 inputs. Availability offsets retain
// the exact millisecond timestamps consumed by the existing CPL-1 predictor.
const numbers = [8,2,5,3,8,3,0,8,4,9,2,9,7,0,6,2,6,7,5,9,2,3,1,6,6,1,1,3,8,5,7,0,4,6,8,7,7,0,1,2,6,0,3,7,5,6,7,4,9,3,1,5,6,1,1,8,9,0,2,1,8,0,2,4,9,8,7,4,5,9,0,4,7,1,4,3,5,1,0,5,2,4,3,8,2,2,1,4,8,8,8,0,2,4,8,6,8,7,5,5,7,1,1,2,6,6,6,1,2,1,8,8,9,6,0,2,3,4,7,7,1,1,9,9,5,3,7,0,1,0,7,1,0,5,2,3,0,6,4,7,5,2,6];
const availabilityOffsets = [30040,30597,31513,32043,32602,33177,34114,35082,35795,30653,29826,30194,29860,31153,30359,29957,29789,30406,30265,29543,29827,29819,29867,29896,29856,30697,30293,29827,29995,29738,29982,29778,29879,30396,29546,29586,29630,29832,29786,29887,29771,29888,28020,28779,29769,30213,29885,30374,30420,29843,29808,29516,29972,29944,29818,29480,30103,28088,33896,29920,29679,30390,31968,30110,33075,29569,29689,29846,29855,29861,29488,30210,29444,29850,29766,29464,29538,29853,30257,30305,29503,29607,29826,28586,29369,28354,30010,29238,29796,29928,29812,29833,30253,29851,30095,30511,29819,31164,29471,29560,30165,29491,29488,29793,30211,29646,30712,30083,29549,29213,29843,30652,31236,29860,30090,30959,29247,28901,29790,29697,30058,37597,38315,38894,39500,40068,40846,41363,41932,43122,43024,44235,43168,45739,42901,46775,42603,47849,42806,49046,43248,50208,43245];
const predictions = 'BSBBBBSBBBBSBBBBSBBBBSBBBBSBBBBSBBBBSBBBBSBSBBBBSBBSBBBSBBBSSSSBSSBSSBBBSSBSBSSSSBSSSSBSSSSBSSSSBSSSSBSSSSBBSSSBBBBSSSSBBSSBBBBSBSSBSSBSSSBSSSS';

export function verifiedBaselineFixture() {
  const records = numbers.map((winningNumber, index) => {
    const issueNumber = String(20261002100052078n + BigInt(index));
    const createdAt = new Date(scheduledStartFromIssue(issueNumber) + availabilityOffsets[index]).toISOString();
    return { issueNumber, winningNumber, createdAt, sourceTime: createdAt };
  });
  const signals = records.map((record, index) => ({
    period_id: record.issueNumber, signal: predictions[index] === 'B' ? 'BIG' : 'SMALL', source: 'server',
    status: index === 142 ? 'pending' : (predictions[index] === 'B') === (record.winningNumber >= 5) ? 'win' : 'loss',
    actual_number: index === 142 ? null : record.winningNumber,
    settled_at: index === 142 ? null : record.createdAt,
  }));
  return { records, signals, baselineId: 'adaptive-baseline-v2-20261002100052078' };
}
