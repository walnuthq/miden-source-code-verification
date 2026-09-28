export class BusyError extends Error {}

// Runs at most `concurrency` tasks at once, with up to `queueSize` more waiting
// in order. Past that, `BusyError` is thrown right away. A waiting task whose
// signal aborts leaves the queue.
export const createLimiter = ({
  concurrency,
  queueSize,
}: {
  concurrency: number;
  queueSize: number;
}) => {
  let active = 0;
  const queue: (() => void)[] = [];

  // A finished task hands its slot straight to the next waiting one.
  const release = () => {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      active--;
    }
  };

  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted();
      if (active < concurrency) {
        active++;
        resolve();
        return;
      }
      if (queue.length >= queueSize) {
        reject(new BusyError("too many requests in progress, retry later"));
        return;
      }
      const onAbort = () => {
        queue.splice(queue.indexOf(start), 1);
        reject(signal?.reason);
      };
      const start = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      queue.push(start);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  return async <T>(task: () => Promise<T>, signal?: AbortSignal) => {
    await acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  };
};
