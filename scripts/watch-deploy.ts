// Watches a merge to main through to its rollout: the GitHub Actions runs the
// merge triggered, the api-compile container rollout, and each Worker's live
// deployment. Read-only: it calls gh and wrangler and never sends a request to
// a production URL (docs/claude/deploys.md says why).
//
//   pnpm watch-deploy <pr-number | sha>
//
// Exit codes: 0 every run green and rolled out, 1 a run failed (or bad input),
// 2 timeout.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const POLL_MS = 15_000;
const STABLE_MIN_MS = 30_000;
const SETTLED_MS = 5 * 60_000;
const NO_RUNS_TIMEOUT_MS = 3 * 60_000;
const RUNS_TIMEOUT_MS = 90 * 60_000;
const ROLLOUT_TIMEOUT_MS = 60 * 60_000;

const CONTAINER_APP_ID = "a03da77b-dc78-405c-a47b-6613bf068a08";
const API_COMPILE_WORKFLOW = "Deploy api-compile to Cloudflare";

type Service = {
  name: string;
  workflow: string;
  // The Worker's wrangler project, when the service is a Worker.
  workerDir?: string;
};

const SERVICES: Service[] = [
  { name: "Check", workflow: "Check" },
  {
    name: "api-compile",
    workflow: API_COMPILE_WORKFLOW,
    workerDir: "apps/api-compile-cloudflare",
  },
  {
    name: "api-registry",
    workflow: "Deploy api-registry to Cloudflare",
    workerDir: "apps/api-registry-cloudflare",
  },
  {
    name: "web-viewer",
    workflow: "Deploy web-viewer to Cloudflare",
    workerDir: "apps/web-viewer-cloudflare",
  },
  {
    name: "web-verifier",
    workflow: "Deploy web-verifier to Cloudflare",
    workerDir: "apps/web-verifier-cloudflare",
  },
  { name: "Pages", workflow: "Deploy Pages" },
];

type Run = {
  databaseId: number;
  workflowName: string;
  status: string;
  conclusion: string;
  createdAt: string;
  updatedAt: string;
  url: string;
};

type ContainerInfo = {
  version: number;
  updated_at: string;
  active_rollout_id?: string;
  configuration: { image: string };
  health: { instances: Record<string, number> };
};

type ContainerInstance = {
  name: string;
  state: string;
  version: number | null;
};

type WorkerDeployment = { created: string; versions: string[] };

class Timeout extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message: string) => {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`${time}Z ${message}`);
};

const exec = async (command: string, args: string[]) =>
  (await run(command, args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

const wrangler = (dir: string, args: string[]) =>
  exec("pnpm", ["-C", dir, "exec", "wrangler", ...args]);

// A gh or wrangler call can fail on a network blip; a poll retries it on the
// next tick instead of ending the watch.
const attempt = async <T>(what: string, fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (error) {
    log(`${what} failed, retrying: ${(error as Error).message.split("\n")[0]}`);
    return undefined;
  }
};

const formatDuration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${seconds % 60}s` : `${seconds}s`;
};

const runDuration = (r: Run) =>
  formatDuration(Date.parse(r.updatedAt) - Date.parse(r.createdAt));

// `gh run list --commit` matches the full 40-character SHA only; a short SHA
// matches nothing and exits 0.
const resolveSha = async (input: string) => {
  if (/^\d{1,6}$/.test(input)) {
    const sha = await exec("gh", [
      "pr",
      "view",
      input,
      "--json",
      "mergeCommit",
      "--jq",
      ".mergeCommit.oid // empty",
    ]);
    if (!sha) throw new Error(`PR #${input} has no merge commit yet`);
    return sha;
  }
  const sha = await exec("git", [
    "rev-parse",
    "--verify",
    "--quiet",
    `${input}^{commit}`,
  ]).catch(() => "");
  if (!sha) {
    throw new Error(
      `${input} is not a local commit; run \`git fetch origin main\` first`,
    );
  }
  return sha;
};

const listRuns = async (sha: string) =>
  JSON.parse(
    await exec("gh", [
      "run",
      "list",
      "--commit",
      sha,
      "--json",
      "databaseId,workflowName,status,conclusion,createdAt,updatedAt,url",
    ]),
  ) as Run[];

const failedJobs = async (r: Run) =>
  exec("gh", [
    "run",
    "view",
    String(r.databaseId),
    "--json",
    "jobs",
    "--jq",
    '[.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | .name] | join(", ")',
  ]);

const containerInfo = async () =>
  JSON.parse(
    await wrangler("apps/api-compile-cloudflare", [
      "containers",
      "info",
      CONTAINER_APP_ID,
      "--json",
    ]),
  ) as ContainerInfo;

const containerInstances = async () =>
  JSON.parse(
    await wrangler("apps/api-compile-cloudflare", [
      "containers",
      "instances",
      CONTAINER_APP_ID,
      "--json",
    ]),
  ) as ContainerInstance[];

// `wrangler deployments status` has no --json; its text prints `Created:` and
// `Version(s):  (100%) <uuid>`, one percentage line per version.
const workerDeployment = async (dir: string): Promise<WorkerDeployment> => {
  const text = await wrangler(dir, ["deployments", "status"]);
  const created = /^Created:\s+(\S+)/m.exec(text)?.[1] ?? "?";
  const versions = [...text.matchAll(/\((\d+%)\)\s+(\S+)/g)].map(
    ([, share, id]) => `${id} (${share})`,
  );
  return { created, versions };
};

// Runs appear within seconds of the merge, so a set whose first run is
// minutes old is already complete: no need to wait out the 30 s.
const settled = (runs: Run[]) =>
  runs.length > 0 &&
  Date.now() - Math.min(...runs.map((r) => Date.parse(r.createdAt))) >
    SETTLED_MS;

// Polls until the set of runs is stable (no new run for two polls, at least
// 30 s after the first), then until each run completes, printing each one as
// it finishes.
const watchRuns = async (sha: string, onFirstPoll: (runs: Run[]) => void) => {
  const start = Date.now();
  const reported = new Set<number>();
  let known = new Set<number>();
  let quietPolls = 0;
  let first = true;
  for (;;) {
    const runs = await attempt("gh run list", () => listRuns(sha));
    if (runs) {
      if (first) {
        onFirstPoll(runs);
        first = false;
      }
      const ids = new Set(runs.map((r) => r.databaseId));
      const grew = [...ids].some((id) => !known.has(id));
      if (grew) {
        for (const r of runs.filter((r) => !known.has(r.databaseId))) {
          log(`run found: ${r.workflowName} (${r.status})`);
        }
      }
      quietPolls = grew ? 0 : quietPolls + 1;
      known = ids;
      for (const r of runs) {
        if (r.status !== "completed" || reported.has(r.databaseId)) continue;
        reported.add(r.databaseId);
        log(`${r.workflowName}: ${r.conclusion} in ${runDuration(r)} ${r.url}`);
        if (r.conclusion !== "success") {
          const jobs = await attempt("gh run view", () => failedJobs(r));
          log(`  failing job: ${jobs || "?"} ${r.url}`);
        }
      }
      const stable =
        (runs.length > 0 &&
          quietPolls >= 2 &&
          Date.now() - start >= STABLE_MIN_MS) ||
        settled(runs);
      if (stable && runs.every((r) => r.status === "completed")) return runs;
      if (runs.length === 0 && Date.now() - start > NO_RUNS_TIMEOUT_MS) {
        throw new Timeout(`no workflow run for ${sha} after 3 minutes`);
      }
    }
    if (Date.now() - start > RUNS_TIMEOUT_MS) {
      throw new Timeout("runs still in progress after 90 minutes");
    }
    await sleep(POLL_MS);
  }
};

// The rollout is done once no rollout is active and the app has moved past
// the run: its version rose above the pre-merge baseline, or, when the run had
// already finished before the watch began, the app was updated after it.
const watchRollout = async (apiCompile: Run, baseline: number | undefined) => {
  const start = Date.now();
  const runEnded = Date.parse(apiCompile.updatedAt);
  let lastState = "";
  for (;;) {
    const info = await attempt("containers info", containerInfo);
    if (info) {
      const moved =
        baseline !== undefined
          ? info.version > baseline
          : Date.parse(info.updated_at) >= runEnded;
      const state = `version ${info.version}, ${
        info.active_rollout_id
          ? `rollout ${info.active_rollout_id} active`
          : "no rollout active"
      }`;
      if (state !== lastState) log(`container app: ${state}`);
      lastState = state;
      if (moved && !info.active_rollout_id) return info;
    }
    if (Date.now() - start > ROLLOUT_TIMEOUT_MS) {
      throw new Timeout("container rollout not done after 60 minutes");
    }
    await sleep(POLL_MS);
  }
};

const printTable = (rows: string[][]) => {
  const widths = rows[0]?.map((_, i) =>
    Math.max(...rows.map((row) => row[i]?.length ?? 0)),
  );
  for (const row of rows) {
    console.log(
      row
        .map((cell, i) => cell.padEnd(widths?.[i] ?? 0))
        .join("  ")
        .trimEnd(),
    );
  }
};

const main = async () => {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: pnpm watch-deploy <pr-number | sha>");
    return 1;
  }
  const sha = await resolveSha(input);
  log(`watching ${sha}`);

  // The baseline is needed only while the api-compile run may still roll out;
  // once that run has finished, the app's updated_at stands in for it.
  let baselinePromise: Promise<number | undefined> = Promise.resolve(undefined);
  const runs = await watchRuns(sha, (firstRuns) => {
    const done = firstRuns.some(
      (r) =>
        r.workflowName === API_COMPILE_WORKFLOW && r.status === "completed",
    );
    const absent =
      settled(firstRuns) &&
      !firstRuns.some((r) => r.workflowName === API_COMPILE_WORKFLOW);
    if (done || absent) return;
    baselinePromise = attempt("containers info", containerInfo).then((info) => {
      if (info) log(`container app baseline: version ${info.version}`);
      return info?.version;
    });
  });
  const baseline = await baselinePromise;

  const byWorkflow = new Map(runs.map((r) => [r.workflowName, r]));
  const notes = new Map<string, string>();

  const apiCompile = byWorkflow.get(API_COMPILE_WORKFLOW);
  if (apiCompile?.conclusion === "success") {
    log("waiting for the container rollout");
    const info = await watchRollout(apiCompile, baseline);
    const instances =
      (await attempt("containers instances", containerInstances)) ?? [];
    const health = Object.entries(info.health.instances)
      .map(([state, count]) => `${state} ${count}`)
      .join(", ");
    log(`container app version ${info.version}, updated ${info.updated_at}`);
    log(`  image ${info.configuration.image.split("@")[1] ?? "?"}`);
    log(`  health: ${health}`);
    for (const instance of instances) {
      log(
        `  instance ${instance.name}: ${instance.state}, version ${instance.version ?? "none"}`,
      );
    }
    log(
      "One confirming request to production api-compile wakes the instance on the new version; ask the user before sending it.",
    );
    log("The status page refreshes at :07 and :37 past the hour.");
    notes.set("api-compile", `container v${info.version}`);
  }

  const workers = SERVICES.flatMap((service) => {
    const r = byWorkflow.get(service.workflow);
    return r && service.workerDir
      ? [{ ...service, r, dir: service.workerDir }]
      : [];
  });
  const deployments = await Promise.all(
    workers.map(({ dir }) =>
      attempt(`deployments status in ${dir}`, () => workerDeployment(dir)),
    ),
  );
  workers.forEach(({ name, r }, i) => {
    const deployment = deployments[i];
    if (!deployment) return;
    // A deployment older than the run means this merge's deploy didn't land.
    const stale =
      Date.parse(deployment.created) < Date.parse(r.createdAt)
        ? " (older than this run)"
        : "";
    log(
      `${name} Worker: created ${deployment.created}${stale}, version ${deployment.versions.join(", ") || "?"}`,
    );
    const versionId = deployment.versions[0]?.split(" ")[0] ?? "?";
    notes.set(
      name,
      [
        notes.get(name),
        `worker ${versionId.slice(0, 8)} ${deployment.created}${stale}`,
      ]
        .filter(Boolean)
        .join(", "),
    );
  });

  console.log("");
  printTable([
    ["service", "run", "duration", "deployed"],
    ...SERVICES.map((service) => {
      const r = byWorkflow.get(service.workflow);
      return [
        service.name,
        r ? r.conclusion : "not run",
        r ? runDuration(r) : "",
        notes.get(service.name) ?? "",
      ];
    }),
  ]);

  return runs.every((r) => r.conclusion === "success") ? 0 : 1;
};

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    log((error as Error).message);
    process.exitCode = error instanceof Timeout ? 2 : 1;
  },
);
