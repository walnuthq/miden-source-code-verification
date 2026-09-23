import midenLogo from "@ui/assets/miden.png";
import { GithubIcon } from "@ui/components/icons/github-icon";
import { ThemeToggle } from "@ui/components/theme-toggle";
import { buttonVariants } from "@ui/components/ui/button";
import { cn } from "@ui/lib/utils";

const GITHUB_URL = "https://github.com/walnuthq/miden-source-code-verification";

export function Navbar({
  title,
  homeHref = "/",
  link,
}: {
  title: string;
  homeHref?: string;
  // Shown left of the GitHub link, e.g. to cross-link the sibling app.
  link?: { label: string; href: string };
}) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
      <a href={homeHref} className="flex items-center gap-2.5">
        <img src={midenLogo} alt="" className="size-8" />
        <span className="text-sm font-semibold tracking-tight">{title}</span>
      </a>
      <div className="flex items-center gap-1">
        {link && (
          <a
            href={link.href}
            className={cn(buttonVariants({ variant: "link" }))}
          >
            {link.label}
          </a>
        )}
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
