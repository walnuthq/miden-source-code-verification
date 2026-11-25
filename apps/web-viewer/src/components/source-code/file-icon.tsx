import { FileCode, FileCog } from "lucide-react";

// MASM and Rust sources get a code icon, manifests (the only other files
// shown) a cog.
export function FileIcon({ path, className }: { path: string; className?: string }) {
  const Icon = path.endsWith(".masm") || path.endsWith(".rs") ? FileCode : FileCog;
  return <Icon className={className} data-icon="inline-start" />;
}
