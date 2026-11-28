import { Library, ShieldQuestionMark } from "lucide-react";
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
// query params. Standard code, which is never verified, gets
// `StandardCodeNotice` instead.
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
          No verified source code was found for this {kind}. If you have the project it was built
          from, you can submit it for verification.
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

// Body of the "not verified" 404 page of standard code, below its
// ResourceHeader, which names the standard components or the standard note:
// why there is nothing to verify, and no CTA, as no project would verify it.
export function StandardCodeNotice({ kind }: { kind: "account" | "note" }) {
  return (
    <Empty className="mt-6 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Library />
        </EmptyMedia>
        <EmptyTitle>{kind === "account" ? "Standard account" : "Standard note"}</EmptyTitle>
        <EmptyDescription>
          {kind === "account"
            ? "Every procedure of this account belongs to one of Miden's standard components, listed above."
            : "This note's script is one of Miden's standard notes, named above."}{" "}
          Standard code is published with Miden itself, so it isn't verified from source here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
