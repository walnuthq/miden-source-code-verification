import { Settings } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "miden-source-code-verification-ui";

type SettingsDialogProps = {
  verifierUrl: string;
  onVerifierUrlChange: (verifierUrl: string) => void;
};

export function SettingsDialog({
  verifierUrl,
  onVerifierUrlChange,
}: SettingsDialogProps) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Settings data-icon="inline-start" />
        Settings
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure the verification server used to verify resources.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="verifier-url">Verifier URL</FieldLabel>
          <Input
            id="verifier-url"
            type="url"
            placeholder="https://miden-source-code-verification-api-registry.walnut.dev"
            value={verifierUrl}
            onChange={(event) => onVerifierUrlChange(event.target.value)}
          />
          <FieldDescription>The verification server endpoint.</FieldDescription>
        </Field>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
