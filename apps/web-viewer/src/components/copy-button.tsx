import { Check, Copy } from "lucide-react";
import { Button } from "miden-source-code-verification-ui";
import { useEffect, useState } from "react";

// `label` names what gets copied, for when it isn't the text beside the button.
export function CopyButton({
  value,
  label = "Copy to clipboard",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={copy}
      aria-label={label}
      title={label}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
