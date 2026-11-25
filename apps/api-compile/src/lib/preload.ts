import { PRELOAD_SCRIPT, PRELOAD_TIMEOUT_MS } from "./constants.ts";
import { execFile } from "./utils.ts";

// The view of the warm cache a build starts in: the two directories the
// script reads from.
type View = { targetDir: string; cargoHome: string };

export type Preload = {
  // Settles once the read is over, however it ended: never rejects.
  settled: Promise<void>;
  // How long the read took, once it has finished; undefined while it runs,
  // when it failed or was stopped, and when there was none.
  durationMs: () => number | undefined;
  // Ends the read now. `settled` follows at once.
  stop: () => void;
};

// Starts reading what the first build after a container start reads off a
// cold disk (the script says what), in a subprocess of its own: it holds no
// build slot and nothing waits for it, so a request that arrives meanwhile is
// served at once, and finds in memory whatever has been read by then. The
// caller stops it when the first build starts: the two would share one disk.
// A failure is logged, once, and changes nothing else: the first build then
// reads its files itself, as it did before. Nothing starts without a view,
// which is the host: it has no image to read.
export const startPreload = (view: View | undefined, script = PRELOAD_SCRIPT): Preload => {
  if (view === undefined) {
    return {
      settled: Promise.resolve(),
      durationMs: () => undefined,
      stop() {},
    };
  }
  const controller = new AbortController();
  const start = performance.now();
  let durationMs: number | undefined;
  const settled = execFile(script, [view.targetDir, view.cargoHome], {
    cwd: "/",
    env: { PATH: process.env.PATH, RUSTUP_HOME: process.env.RUSTUP_HOME },
    timeout: PRELOAD_TIMEOUT_MS,
    signal: controller.signal,
  }).then(
    ({ stdout }) => {
      durationMs = performance.now() - start;
      const megabytes = Math.round(Number(stdout) / 1024 / 1024);
      console.info(`first build's files read in ${Math.round(durationMs)} ms (${megabytes} MiB)`);
    },
    (error: unknown) => {
      // Stopped, by the first build or a shutdown: nothing went wrong.
      if (!controller.signal.aborted) {
        console.error("reading the first build's files failed", error);
      }
    },
  );
  return {
    settled,
    durationMs: () => durationMs,
    stop: () => controller.abort(),
  };
};
