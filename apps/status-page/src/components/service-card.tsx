import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "miden-source-code-verification-ui";

import type { ServiceStatus } from "@/lib/types";

function StatusBadge({ healthy }: { healthy: boolean }) {
  if (healthy) {
    return (
      <Badge
        variant="outline"
        className="border-green-600/50 text-green-700 dark:border-green-500/50 dark:text-green-400"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-green-600 dark:bg-green-500"
        />
        Healthy
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      Unhealthy
    </Badge>
  );
}

export function ServiceCard({ service }: { service: ServiceStatus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <CardDescription>{service.description}</CardDescription>
        <CardAction>
          <StatusBadge healthy={service.healthy} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="truncate font-mono">
            <a
              href={service.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline-offset-4 hover:underline"
            >
              {service.url}
            </a>
          </dd>

          <dt className="text-muted-foreground">Response</dt>
          <dd className="font-mono">
            {service.httpStatus === null
              ? "no response"
              : `HTTP ${service.httpStatus}`}{" "}
            · {service.responseTimeMs}ms
          </dd>
        </dl>

        {service.error !== null && (
          <p className="font-mono text-xs text-destructive">{service.error}</p>
        )}

        {service.kind === "json" && service.payload !== null && (
          <pre className="overflow-x-auto bg-muted/50 p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(service.payload, null, 2)}
          </pre>
        )}

        {service.kind === "liveness" && service.error === null && (
          <p className="text-xs text-muted-foreground">
            Serves the browser app; only reachability is checked.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
