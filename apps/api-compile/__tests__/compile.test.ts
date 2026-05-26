import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(__dirname, "../project-template");

const api = request(process.env.API_URL ?? "http://localhost:8080");

const readProjectFiles = async (
  rootDir: string,
): Promise<Record<string, string>> => {
  const entries = await readdir(rootDir, {
    recursive: true,
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const full = path.join(entry.parentPath, entry.name);
      const rel = path.relative(rootDir, full);
      return { path: rel, content: await readFile(full, "utf8") };
    }),
  );
  return files
    .filter((file) => file !== undefined)
    .reduce<Record<string, string>>(
      (previousValue, currentValue) => ({
        ...previousValue,
        [currentValue.path]: currentValue.content,
      }),
      {},
    );
};

describe("POST /compile", () => {
  it("rejects requests with no files object", async () => {
    const res = await api.post("/compile").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing files object" });
  });

  it("rejects requests missing Cargo.toml", async () => {
    const res = await api
      .post("/compile")
      .send({ files: { "src/lib.rs": "" } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing Cargo.toml" });
  });

  it("doesn't compile the buggy counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replace(", Word", "");

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).not.toHaveProperty("masp");
    expect(res.body).not.toHaveProperty("digest");
    expect(res.body).not.toHaveProperty("manifest");
  });

  it("compiles the counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles the increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });
});
