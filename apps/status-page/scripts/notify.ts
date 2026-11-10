import fs from "node:fs";
import path from "node:path";
import type {
  ServiceHealth,
  ServiceStatus,
  StatusSnapshot,
} from "../src/lib/types.ts";
import { formatDuration, type Reason, reasonToPost } from "./lib/alerts.ts";
import { statusPageUrl } from "./status-page-url.ts";

// Posts to Slack when a service's health changes. A **pure reader** of the
// public/status.json that scripts/probe.ts wrote: it writes nothing. The workflow
// (.github/workflows/deploy-pages.yml) runs it only after that snapshot is
// published, since the published copy is the next probe's memory: a post about
// a snapshot that never went live gets no follow-up.
//
// The whole design goal is silence. A 30-minute cron with no memory would post
// 48 identical "api-compile is down" messages a day, so this only speaks when
// the state changes, plus a reminder every 6 hours while an outage continues.
//
// It never fails the build: no webhook, an unreachable Slack, a malformed
// snapshot — all log and exit 0.

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? "";
const DRY_RUN = process.argv.includes("--dry-run");

const SLACK_TIMEOUT_MS = 10_000;

// Slack's own palette, so the attachment stripe reads the same as every other
// alert in the workspace.
const colors: Record<ServiceHealth, string> = {
  healthy: "#2eb67d",
  degraded: "#ecb22e",
  unhealthy: "#e01e5a",
};

const icons: Record<ServiceHealth, string> = {
  healthy: "✅",
  degraded: "🟡",
  unhealthy: "🔴",
};

const CODE_FENCE = "```";

/** Slack rejects a section whose text exceeds 3000 characters. */
const truncate = (text: string, limit = 2900) =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n… truncated${CODE_FENCE}`;

const formatTimestamp = (iso: string) =>
  `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso))} UTC`;

/** Present tense, without the word "down", for each non-healthy state. */
const states: Record<Exclude<ServiceHealth, "healthy">, string> = {
  unhealthy: "down",
  degraded: "degraded",
};

const headline = (service: ServiceStatus, reason: Reason) => {
  const icon = icons[service.health];
  if (service.health === "healthy") return `${icon} ${service.name} recovered`;
  const state = states[service.health];
  return reason.kind === "reminder"
    ? `${icon} ${service.name} is still ${state} (${reason.downFor})`
    : `${icon} ${service.name} is ${state}`;
};

const summaryLine = (
  service: ServiceStatus,
  reason: Reason,
  checkedAt: string,
) => {
  // The link the reader wants first: the service that is actually broken.
  const link = `<${service.url}|${service.url.replace(/^https?:\/\//, "")}>`;

  const total = service.endpoints.length;
  const checks = `${total} ${total === 1 ? "check" : "checks"}`;

  if (service.health === "healthy") {
    // How long the service was down, which is the length of the state it has
    // just left. `since` cannot answer that: the health changed on this run, so
    // probe.ts moved it to now and the difference would always be zero. Older
    // snapshots have no `previousSince`, and then the duration is simply not
    // known — say nothing rather than report `0m`.
    const previousSince = service.previousSince
      ? new Date(service.previousSince).getTime()
      : Number.NaN;
    const downFor = Number.isFinite(previousSince)
      ? formatDuration(new Date(checkedAt).getTime() - previousSince)
      : null;
    return `*${link}* is back — all ${checks} passing${downFor ? ` after ${downFor} down` : ""}.`;
  }

  const failing = service.endpoints.filter(
    (endpoint) => endpoint.health !== "healthy",
  ).length;
  const when =
    reason.kind === "reminder"
      ? `since ${formatTimestamp(service.since)}`
      : `as of ${formatTimestamp(checkedAt)}`;
  return `*${link}* — ${failing} of ${checks} failing ${when}.`;
};

const attachmentFor = (
  service: ServiceStatus,
  reason: Reason,
  snapshot: StatusSnapshot,
  links: string,
) => {
  const failing = service.endpoints.filter(
    (endpoint) => endpoint.health !== "healthy",
  );

  return {
    color: colors[service.health],
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: headline(service, reason),
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: summaryLine(service, reason, snapshot.checkedAt),
        },
      },
      // The probe's one-line errors are the whole diagnosis; a code block keeps
      // them readable and stops Slack mangling URLs into links.
      ...(failing.length > 0
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: truncate(
                  CODE_FENCE +
                    failing
                      .map((endpoint) => `${endpoint.label}: ${endpoint.error}`)
                      .join("\n") +
                    CODE_FENCE,
                ),
              },
            },
          ]
        : []),
      // Omitted entirely when empty: Slack rejects a block whose text is an
      // empty string, which is what running outside Actions produces.
      ...(links
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: links }] }]
        : []),
    ],
  };
};

/** Status page and workflow run, shown small under each attachment. */
const contextLinks = () => {
  const parts: string[] = [];
  const statusPage = statusPageUrl();
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;

  if (statusPage) parts.push(`<${statusPage}|Status page>`);
  if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
    parts.push(
      `<${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}|Workflow run>`,
    );
  }
  return parts.join("  ·  ");
};

const readSnapshot = (): StatusSnapshot | null => {
  const file = path.resolve(import.meta.dirname, "..", "public", "status.json");
  try {
    const snapshot = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as StatusSnapshot;
    if (!Array.isArray(snapshot.services)) {
      console.log(`${file} has no services array — nothing to notify about`);
      return null;
    }
    return snapshot;
  } catch (error) {
    console.log(
      `could not read ${file}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    console.log("run `pnpm probe` first");
    return null;
  }
};

const snapshot = readSnapshot();

if (snapshot) {
  const posts = snapshot.services
    .map((service) => ({ service, reason: reasonToPost(service, snapshot) }))
    .filter(
      (entry): entry is { service: ServiceStatus; reason: Reason } =>
        entry.reason !== null,
    );

  for (const { service, reason } of posts) {
    console.log(
      `${service.name}: ${reason.kind} → ${headline(service, reason)}`,
    );
  }

  if (posts.length === 0) {
    console.log("nothing to report — no health changes since the last run");
  } else {
    const links = contextLinks();
    const payload = {
      // Shown in notifications and by clients that cannot render blocks.
      text: posts
        .map(({ service, reason }) => headline(service, reason))
        .join(", "),
      attachments: posts.map(({ service, reason }) =>
        attachmentFor(service, reason, snapshot, links),
      ),
    };

    if (DRY_RUN || !WEBHOOK_URL) {
      console.log(
        DRY_RUN
          ? "--dry-run: the payload below was not sent"
          : "SLACK_WEBHOOK_URL is not set — skipping the post",
      );
      console.log(JSON.stringify(payload, null, 2));
    } else {
      try {
        const response = await fetch(WEBHOOK_URL, {
          method: "POST",
          signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        // Slack answers `ok` in the body, and an error as plain text.
        const body = (await response.text()).trim();
        console.log(
          response.ok && body === "ok"
            ? `posted ${posts.length} notification(s) to Slack`
            : `Slack rejected the message: HTTP ${response.status} ${body}`,
        );
      } catch (error) {
        // A Slack outage must never take the status page down with it.
        console.log(
          `could not reach Slack: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }
}
