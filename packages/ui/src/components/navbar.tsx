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
  children,
}: {
  title: string;
  homeHref?: string;
  // Shown left of the GitHub link, e.g. to cross-link the sibling app.
  link?: { label: string; href: string };
  // App-specific controls shown left of the link, e.g. a network selector.
  children?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-2 border-b sm:gap-4 px-4 py-3 sm:px-6">
      {/* Logo only on phones, where the title and the controls don't fit side
          by side; the label keeps the link named. */}
      <a
        href={homeHref}
        aria-label={title}
        className="flex shrink-0 items-center gap-2.5 sm:min-w-0 sm:shrink"
      >
        <img src={midenLogo} alt="" className="size-8 shrink-0" />
        <span className="hidden truncate text-sm font-semibold tracking-tight sm:block">
          {title}
        </span>
      </a>
      <div className="flex shrink-0 items-center gap-1">
        {children}
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
