import midenLogo from "@/assets/miden.png";
import { GithubIcon } from "@/components/icons/github-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const GITHUB_URL = "https://github.com/walnuthq/miden-source-code-verification";

export function Navbar() {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
      <a href="/" className="flex items-center gap-2.5">
        <img src={midenLogo} alt="" className="size-8" />
        <span className="text-sm font-semibold tracking-tight">
          Miden Source Code Verification Web Verifier
        </span>
      </a>
      <div className="flex items-center gap-1">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="View source on GitHub"
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
        >
          <GithubIcon />
        </a>
        <ThemeToggle />
      </div>
    </header>
  );
}
