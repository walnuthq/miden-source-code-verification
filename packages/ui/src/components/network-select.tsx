import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/select";
import { cn } from "@ui/lib/utils";
import {
  getNetwork,
  isNetworkId,
  type NetworkId,
  networks,
} from "miden-source-code-verification-utils/networks";

// Status dot per network.
const DOT_CLASS: Record<NetworkId, string> = {
  mtst: "bg-success",
  mdev: "bg-chart-2",
};

function NetworkLabel({ network }: { network: NetworkId }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn("size-2 rounded-full", DOT_CLASS[network])}
      />
      {getNetwork(network).label}
    </span>
  );
}

// The navbar's network selector. Controlled: each app keeps the network in its
// URL and passes it in.
export function NetworkSelect({
  value,
  onValueChange,
}: {
  value: NetworkId;
  onValueChange: (network: NetworkId) => void;
}) {
  return (
    <Select
      items={networks}
      value={value}
      onValueChange={(next) => {
        if (isNetworkId(next)) onValueChange(next);
      }}
    >
      <SelectTrigger aria-label="Network" className="w-28 sm:mr-1 sm:w-32">
        <SelectValue>
          {(network: NetworkId) => <NetworkLabel network={network} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {networks.map(({ value }) => (
            <SelectItem key={value} value={value}>
              <NetworkLabel network={value} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
