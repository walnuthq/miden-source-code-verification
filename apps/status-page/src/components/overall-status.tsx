import { CircleAlert, CircleCheck } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "miden-source-code-verification-ui";

import { formatTimestamp } from "@/lib/format";
import type { ServiceStatus } from "@/lib/types";

export function OverallStatus({
  checkedAt,
  services,
}: {
  checkedAt: string;
  services: ServiceStatus[];
}) {
  const down = services.filter((service) => !service.healthy);
  const checked = `Last checked ${formatTimestamp(checkedAt)}.`;

  if (down.length === 0) {
    return (
      // Same green pairing the verifier uses for a successful verification.
      <Alert className="border-green-600/50 text-green-700 dark:border-green-500/50 dark:text-green-400">
        <CircleCheck />
        <AlertTitle>All systems operational</AlertTitle>
        <AlertDescription className="text-green-700/90 dark:text-green-400/90">
          All {services.length} services responded successfully. {checked}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>
        {down.length} of {services.length}{" "}
        {down.length === 1 ? "service is" : "services are"} unhealthy
      </AlertTitle>
      <AlertDescription>
        {down.map((service) => service.name).join(", ")}. {checked}
      </AlertDescription>
    </Alert>
  );
}
