/** One local inference at a time, including across chat and automatic summaries. */
export class LocalModelSlot {
  private held = false;
  private waiters: Array<{ signal: AbortSignal; start: () => void }> = [];

  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (!this.held) { this.held = true; return Promise.resolve(this.releaseOnce()); }
    return new Promise((resolve, reject) => {
      const waiter = { signal, start: () => { signal.removeEventListener('abort', abort); resolve(this.releaseOnce()); } };
      const abort = () => { this.waiters = this.waiters.filter(entry => entry !== waiter); reject(signal.reason); };
      this.waiters.push(waiter);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      let next;
      while ((next = this.waiters.shift())) {
        if (!next.signal.aborted) { next.start(); return; }
      }
      this.held = false;
    };
  }
}
