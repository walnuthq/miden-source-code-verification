// Public surface of the shared design system. Apps import from
// "miden-source-code-verification-ui" only — never reach into src/ directly.

export { GithubIcon } from "@ui/components/icons/github-icon";
export { Navbar } from "@ui/components/navbar";
export { ThemeProvider, useTheme } from "@ui/components/theme-provider";
export { ThemeToggle } from "@ui/components/theme-toggle";
export {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@ui/components/ui/alert";
export { Badge, badgeVariants } from "@ui/components/ui/badge";
export { Button, buttonVariants } from "@ui/components/ui/button";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ui/components/ui/card";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@ui/components/ui/dialog";
export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@ui/components/ui/field";
export { Input } from "@ui/components/ui/input";
export { Label } from "@ui/components/ui/label";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/select";
export { Separator } from "@ui/components/ui/separator";
export { cn } from "@ui/lib/utils";
