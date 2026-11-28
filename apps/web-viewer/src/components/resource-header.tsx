import {
  ArrowLeftRight,
  AtSign,
  Blocks,
  ChartLine,
  CircleArrowUp,
  CircleCheck,
  CirclePause,
  CirclePlus,
  CircleX,
  Coins,
  Crown,
  FileCheck,
  Flame,
  Gem,
  Globe,
  HandCoins,
  Hash,
  KeyRound,
  KeySquare,
  ListChecks,
  ListX,
  type LucideIcon,
  Network,
  Pause,
  Puzzle,
  Receipt,
  ReceiptText,
  Scale,
  ScanSearch,
  ScrollText,
  Send,
  ShieldCheck,
  ShieldOff,
  UserCog,
  UsersRound,
  Wallet,
} from "lucide-react";
import { Badge } from "miden-source-code-verification-ui";

import { type DetailField, DetailsCard } from "@/components/details-card";
import type { VerificationStatus } from "@/lib/verification-status";

// Standard components by the name api-compile's `/import` detects them under.
// Unknown names fall back to `Puzzle`.
const standardComponentIcons: Record<string, LucideIcon> = {
  BasicWallet: Wallet,
  NoteCreator: Send,
  FungibleFaucet: Coins,
  CodeInspection: ScanSearch,
  SchemaCommitment: FileCheck,
  Authority: Crown,
  Ownable2Step: UserCog,
  RoleBasedAccessControl: UsersRound,
  AuthSingleSig: KeyRound,
  AuthMultisig: KeySquare,
  AuthMultisigSmart: KeySquare,
  AuthGuardedMultisig: KeySquare,
  AuthNoAuth: ShieldOff,
  AuthNetworkAccount: Network,
  AuthTxFeeCollector: HandCoins,
  NonFungibleFaucet: Gem,
  Pausable: Pause,
  PausableManager: CirclePause,
  UpgradeManager: CircleArrowUp,
  PriceOracle: ChartLine,
  BasicConstantFeePolicy: Receipt,
  ConstantFeeManager: ReceiptText,
  TokenPolicyManager: Scale,
  TokenPolicyManagerV2: Scale,
  MintAllowAll: CirclePlus,
  MintOwnerOnly: CirclePlus,
  BurnAllowAll: Flame,
  BurnOwnerOnly: Flame,
  MinBurnAmount: Flame,
  TransferAllowAll: ArrowLeftRight,
  BasicAllowlist: ListChecks,
  AllowlistManager: ListChecks,
  BasicBlocklist: ListX,
  BlocklistManager: ListX,
};

// Top of a verified resource page (and of its "not verified" 404 page): the
// resource kind as the page's h1 ("Verified …" unless it's the 404 page), then
// its details as a `DetailsCard`. An account is identified first by its address, then by
// its hex ID. With `explorerUrl`, that first identifier links to the resource
// on the network's block explorer.
export function ResourceHeader({
  kind,
  id,
  networkName,
  address,
  explorerUrl,
  verified = false,
  verificationStatus,
  standardAccountComponents = [],
  standardNote,
}: {
  kind: "account" | "note";
  id: string;
  networkName: string;
  address?: string;
  explorerUrl?: string;
  verified?: boolean;
  verificationStatus?: VerificationStatus;
  standardAccountComponents?: string[];
  // The standard note (`P2ID`, …) a note is, on its "not verified" page.
  standardNote?: string;
}) {
  const label = kind === "account" ? "Account" : "Note";
  const fields: DetailField[] = [
    ...(address ? [{ label: `${label} Address`, icon: AtSign, value: address }] : []),
    { label: `${label} ID`, icon: Hash, value: id },
  ].map((field, index) => ({
    ...field,
    copyable: true,
    href: index === 0 ? explorerUrl : undefined,
  }));
  fields.push({ label: "Network", icon: Globe, value: networkName });
  if (verificationStatus) {
    fields.push({
      label: "Verification Status",
      icon: ShieldCheck,
      value: <VerificationStatusBadge status={verificationStatus} />,
    });
  }
  if (standardAccountComponents.length > 0) {
    fields.push({
      label: "Standard Account Components",
      icon: Blocks,
      value: (
        <span className="flex flex-wrap gap-1">
          {standardAccountComponents.map((name) => {
            const Icon = standardComponentIcons[name] ?? Puzzle;
            return (
              <Badge key={name} variant="success">
                <Icon />
                {name}
              </Badge>
            );
          })}
        </span>
      ),
    });
  }

  if (standardNote) {
    fields.push({
      label: "Standard Note",
      icon: ScrollText,
      value: (
        <Badge variant="success">
          <ScrollText />
          {standardNote}
        </Badge>
      ),
    });
  }

  return (
    <header className="mt-3 mb-2 flex flex-col gap-3">
      <h1 className="text-lg font-semibold md:text-xl">{verified ? `Verified ${label}` : label}</h1>
      <DetailsCard fields={fields} />
    </header>
  );
}

// Fully verified once every procedure of the resource is accounted for by a
// standard component or a verified package.
function VerificationStatusBadge({ status }: { status: VerificationStatus }) {
  const { verified, total } = status;
  if (verified >= total) {
    return (
      <Badge variant="success">
        <CircleCheck />
        Fully verified
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <CircleX />
      Partially verified {verified}/{total}
    </Badge>
  );
}
