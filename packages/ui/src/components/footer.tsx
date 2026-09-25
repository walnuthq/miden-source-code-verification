import { GithubIcon } from "@ui/components/icons/github-icon";
import { XIcon } from "@ui/components/icons/x-icon";
import { buttonVariants } from "@ui/components/ui/button";
import { cn } from "@ui/lib/utils";

// Miden's own accounts, as MidenScan's footer links them — unlike the navbar's
// GitHub link, which points at this project's repository.
const LINKS = [
  { label: "Miden on X", href: "https://x.com/0xMiden", icon: XIcon },
  {
    label: "Miden on GitHub",
    href: "https://github.com/0xMiden",
    icon: GithubIcon,
  },
];

// Page footer, after MidenScan's. Not fixed: it follows the content, and
// `mt-auto` pins it to the bottom of a short page when the app lays the page
// out as a full-height flex column (`flex min-h-svh flex-col`).
export function Footer() {
  return (
    <footer className="mt-auto flex items-center justify-center gap-2 border-t px-4 py-6 sm:justify-end sm:px-6">
      {LINKS.map(({ label, href, icon: Icon }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={label}
          title={label}
          className={cn(buttonVariants({ variant: "outline", size: "icon" }))}
        >
          <Icon />
        </a>
      ))}
    </footer>
  );
}
