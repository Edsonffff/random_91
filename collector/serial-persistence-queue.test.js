import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryableSerialQueue } from './serial-persistence-queue.js';

test('failed source batch remains queued and retry executes it once', async () => {
  let available = false;
  let attempts = 0;
  const errors = [];
  const queue = new RetryableSerialQueue({ onError: (error) => errors.push(error.message) });
  const result = queue.enqueue(async () => {
    attempts++;
    if (!available) throw new Error('database unavailable');
    return 'persisted';
  });
  await assert.rejects(result, /database unavailable/);
  assert.equal(queue.status().pendingCount, 1);
  assert.equal(queue.status().blocked, true);
  assert.deepEqual(errors, ['database unavailable']);
  available = true;
  const retry = new Promise((resolve) => {
    const interval = setInterval(() => {
      if (queue.status().pendingCount === 0) { clearInterval(interval); resolve(); }
    }, 1);
  });
  queue.retry();
  await retry;
  assert.equal(attempts, 2);
  assert.equal(queue.status().pendingCount, 0);
  assert.equal(queue.status().running, false);
});

test('later batches cannot pass a failed batch', async () => {
  const order = [];
  let fail = true;
  const queue = new RetryableSerialQueue();
  const first = queue.enqueue(async () => { order.push('first'); if (fail) throw new Error('blocked'); });
  const second = queue.enqueue(async () => { order.push('second'); });
  await assert.rejects(first, /blocked/);
  assert.equal(queue.status().pendingCount, 2);
  fail = false;
  queue.retry();
  await assert.doesNotReject(second);
  assert.deepEqual(order, ['first', 'first', 'second']);
});
