// Bound independent work while retaining input order and awaiting every started
// task before propagating a failure. A failed task prevents further scheduling.
export const REVIEW_CONCURRENCY = 8;
export async function mapConcurrent(items, work, { concurrency = REVIEW_CONCURRENCY, shouldStop = () => false } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw Error('Invalid review concurrency');
  const values = Array.from(items), results = new Array(values.length);
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (!failure && !shouldStop()) {
      const index = next++;
      if (index >= values.length) return;
      try { results[index] = await work(values[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

// Serialize durable writes, not network inference. A failed write poisons this
// session so no later reservation can accidentally resume an uncertain ledger.
export function serialWrites(write) {
  let tail = Promise.resolve();
  return (...args) => {
    const result = tail.then(() => write(...args));
    tail = result;
    // Attach a handler even if the caller has not yet awaited this queued write.
    result.catch(() => {});
    return result;
  };
}
