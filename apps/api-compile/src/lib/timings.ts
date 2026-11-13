// How long each part of a request took, in ms, by name. A route that reports
// them hands an empty record to the code it calls and answers with what came
// back as a `Server-Timing` header: the container's log can't be read from
// the CLI, a response header can.
export type Timings = Record<string, number>;

// Runs `run` and adds its duration to `timings[name]`, when there is a record
// to add it to. A part that throws is still counted.
export const timed = async <T>(
  timings: Timings | undefined,
  name: string,
  run: () => Promise<T>,
) => {
  const start = performance.now();
  try {
    return await run();
  } finally {
    if (timings) {
      timings[name] = (timings[name] ?? 0) + performance.now() - start;
    }
  }
};

// The `Server-Timing` header value: `layout;dur=412, cargo;dur=630`.
export const serverTiming = (timings: Timings) =>
  Object.entries(timings)
    .map(([name, ms]) => `${name};dur=${Math.round(ms)}`)
    .join(", ");
