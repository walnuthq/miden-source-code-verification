import { FolderUp } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  collectProjectFiles,
  type ProjectFiles,
} from "@/lib/collect-project-files";

type ImportSourcesProps = {
  files: Record<string, string>;
  entrypoints: string[];
  entrypoint: string;
  onImport: (result: ProjectFiles) => void;
  onEntrypointChange: (entrypoint: string) => void;
};

export function ImportSources({
  files,
  entrypoints,
  entrypoint,
  onImport,
  onEntrypointChange,
}: ImportSourcesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileCount = Object.keys(files).length;

  return (
    <Card className="bg-muted/30">
      <CardHeader>
        <CardTitle>Import Sources</CardTitle>
        <CardDescription>
          Select a directory of source files to verify the resource.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button variant="outline" onClick={() => inputRef.current?.click()}>
          <FolderUp data-icon="inline-start" />
          Select Folder
        </Button>
        <input
          ref={inputRef}
          id="import-sources-input"
          type="file"
          multiple
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={async (event) => {
            const input = event.currentTarget;
            if (input.files?.length) {
              onImport(await collectProjectFiles(input.files));
            }
            // Reset so re-selecting the same folder fires onChange again.
            input.value = "";
          }}
        />
        {fileCount > 0 && (
          <p className="text-muted-foreground">
            {fileCount} {fileCount === 1 ? "file" : "files"} imported
          </p>
        )}
        {entrypoints.length > 1 && (
          <Field>
            <FieldLabel htmlFor="entrypoint">Entrypoint</FieldLabel>
            <Select
              items={entrypoints.map((value) => ({ label: value, value }))}
              value={entrypoint}
              onValueChange={(value) => onEntrypointChange(value ?? ".")}
            >
              <SelectTrigger id="entrypoint" className="w-full">
                <SelectValue placeholder="Select entrypoint" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {entrypoints.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}
