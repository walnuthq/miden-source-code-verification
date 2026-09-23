import { ShieldQuestionMark } from "lucide-react";
import {
  buttonVariants,
  cn,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "miden-source-code-verification-ui";

import { WEB_VERIFIER_URL } from "@/lib/constants";

// Body of a resource's "not verified" 404 page, below its ResourceHeader: a CTA
// to the web-verifier, whose form is seeded from the `resource` and `network`
// query params.
export function NotVerified({
  kind,
  id,
  networkId,
}: {
  kind: "account" | "note";
  id: string;
  networkId: string;
}) {
  const label = kind === "account" ? "Account" : "Note";
  const params = new URLSearchParams({ resource: id, network: networkId });
  const verifyUrl = `${WEB_VERIFIER_URL}?${params}`;
  return (
    <Empty className="mt-6 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldQuestionMark />
        </EmptyMedia>
        <EmptyTitle>{label} not verified</EmptyTitle>
        <EmptyDescription>
          No verified source code was found for this {kind}. If you have its
          Rust project, you can submit it for verification.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/* Not <Button render={<a />}>, which forces role="button" on a link. */}
        <a href={verifyUrl} className={cn(buttonVariants())}>
          Verify {label}
        </a>
      </EmptyContent>
    </Empty>
  );
}
