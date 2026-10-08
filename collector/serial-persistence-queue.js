/** A retryable serial queue for one source's durable persistence path. */
export class RetryableSerialQueue {
  constructor({ onError = () => {} } = {}) {
    this.onError = onError;
    this.items = [];
    this.running = false;
  }

  enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.items.push({ operation, resolve, reject });
      void this.pump();
    });
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.items.length) {
        const item = this.items[0];
        try {
          const result = await item.operation();
          this.items.shift();
          item.resolve(result);
        } catch (error) {
          // Keep the failed operation at the head. A later retry repeats the
          // exact source batch, and its persistence must remain idempotent.
          item.reject(error);
          this.onError(error);
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }

  retry() { void this.pump(); }

  status() {
    return { pendingCount: this.items.length, running: this.running, blocked: this.items.length > 0 && !this.running };
  }
}
