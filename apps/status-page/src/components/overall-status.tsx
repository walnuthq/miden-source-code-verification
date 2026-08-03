import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "miden-source-code-verification-ui";

import { formatTimestamp } from "@/lib/format";
import type { ServiceStatus } from "@/lib/types";

const countChecks = (services: ServiceStatus[]) =>
  services.reduce((total, service) => total + service.endpoints.length, 0);

const describe = (service: ServiceStatus) => {
  const failing = service.endpoints.filter(
    (endpoint) => endpoint.health !== "healthy",
  ).length;
  return `${service.name} (${failing} of ${service.endpoints.length} checks failing)`;
};

export function OverallStatus({
  checkedAt,
  services,
}: {
  checkedAt: string;
  services: ServiceStatus[];
}) {
  const degraded = services.filter((s) => s.health === "degraded");
  const down = services.filter((s) => s.health === "unhealthy");
  const checked = `Last checked ${formatTimestamp(checkedAt)}.`;

  if (degraded.length === 0 && down.length === 0) {
    return (
      // Same green pairing the verifier uses for a successful verification.
      <Alert className="border-green-600/50 text-green-700 dark:border-green-500/50 dark:text-green-400">
        <CircleCheck />
        <AlertTitle>All systems operational</AlertTitle>
        <AlertDescription className="text-green-700/90 dark:text-green-400/90">
          All {countChecks(services)} checks across {services.length} services
          passed. {checked}
        </AlertDescription>
      </Alert>
    );
  }

  // Anything fully down outranks a partial failure.
  if (down.length > 0) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>
          {down.length} of {services.length} services{" "}
          {down.length === 1 ? "is" : "are"} unhealthy
        </AlertTitle>
        <AlertDescription>
          {[...down.map((s) => s.name), ...degraded.map(describe)].join(", ")}.{" "}
          {checked}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-amber-600/50 text-amber-700 dark:border-amber-500/50 dark:text-amber-400">
      <TriangleAlert />
      <AlertTitle>
        {degraded.length} of {services.length} services{" "}
        {degraded.length === 1 ? "is" : "are"} degraded
      </AlertTitle>
      <AlertDescription className="text-amber-700/90 dark:text-amber-400/90">
        {degraded.map(describe).join(", ")}. {checked}
      </AlertDescription>
    </Alert>
  );
}
