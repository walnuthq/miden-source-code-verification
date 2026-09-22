import { Check, Copy } from "lucide-react";
import { Button } from "miden-source-code-verification-ui";
import { useEffect, useState } from "react";

export function CopyButton({ value }: { value: string }) {
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
      aria-label="Copy to clipboard"
      title="Copy to clipboard"
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
