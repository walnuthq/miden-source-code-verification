import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "miden-source-code-verification-ui";

import type {
  CheckHealth,
  EndpointStatus,
  ServiceHealth,
  ServiceStatus,
} from "@/lib/types";

// Same green/amber/destructive triad the verifier uses for its result alerts.
const healthStyles: Record<ServiceHealth, string> = {
  healthy:
    "border-green-600/50 text-green-700 dark:border-green-500/50 dark:text-green-400",
  degraded:
    "border-amber-600/50 text-amber-700 dark:border-amber-500/50 dark:text-amber-400",
  unhealthy: "",
};

const healthDots: Record<ServiceHealth, string> = {
  healthy: "bg-green-600 dark:bg-green-500",
  degraded: "bg-amber-600 dark:bg-amber-500",
  unhealthy: "bg-current",
};

function HealthBadge({
  health,
  children,
}: {
  health: ServiceHealth;
  children: React.ReactNode;
}) {
  return (
    <Badge
      variant={health === "unhealthy" ? "destructive" : "outline"}
      className={healthStyles[health]}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${healthDots[health]}`}
      />
      {children}
    </Badge>
  );
}

function EndpointRow({ endpoint }: { endpoint: EndpointStatus }) {
  const health: CheckHealth = endpoint.health;
  return (
    <div className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <code className="truncate font-mono text-xs">{endpoint.label}</code>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {endpoint.httpStatus === null
              ? "no response"
              : `HTTP ${endpoint.httpStatus}`}{" "}
            · {endpoint.responseTimeMs}ms
          </span>
          <HealthBadge health={health}>
            {health === "healthy" ? "Healthy" : "Unhealthy"}
          </HealthBadge>
        </div>
      </div>

      {endpoint.error !== null && (
        <p className="font-mono text-xs text-destructive">{endpoint.error}</p>
      )}

      {endpoint.summary !== null && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {Object.entries(endpoint.summary).map(([key, value]) => (
            <div key={key} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="truncate font-mono">
                {typeof value === "boolean" ? (
                  <span
                    className={
                      value
                        ? "text-green-700 dark:text-green-400"
                        : "text-destructive"
                    }
                  >
                    {value ? "✓ true" : "✗ false"}
                  </span>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {endpoint.payload !== null && (
        <pre className="overflow-x-auto bg-muted/50 p-3 font-mono text-xs leading-relaxed">
          {JSON.stringify(endpoint.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ServiceCard({ service }: { service: ServiceStatus }) {
  const healthy = service.endpoints.filter(
    (endpoint) => endpoint.health === "healthy",
  ).length;
  const total = service.endpoints.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <CardDescription>{service.description}</CardDescription>
        <CardAction>
          <HealthBadge health={service.health}>
            {service.health === "healthy" && "Healthy"}
            {service.health === "degraded" && `Degraded ${healthy}/${total}`}
            {service.health === "unhealthy" && "Unhealthy"}
          </HealthBadge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <p className="truncate text-xs">
          <a
            href={service.url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono underline-offset-4 hover:underline"
          >
            {service.url}
          </a>
        </p>
        {service.endpoints.map((endpoint) => (
          <EndpointRow key={endpoint.id} endpoint={endpoint} />
        ))}
      </CardContent>
    </Card>
  );
}
