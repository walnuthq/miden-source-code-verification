import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  editProjectFile,
  projectFile,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../examples");
const counterContractDir = `${examplesDir}/counter-contract`;
const basicWalletDir = `${examplesDir}/basic-wallet`;
const bankDir = `${examplesDir}/miden-bank`;

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("POST /compile", () => {
  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const res = await api
      .post("/compile")
      .send({ files: { "src/lib.rs": files["src/lib.rs"] } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects a file path that would leave the project", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const res = await api
      .post("/compile")
      .send({ files: { ...files, "../evil.rs": "" } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid file path: ../evil.rs");
  });

  it("doesn't compile a buggy counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();
    editProjectFile(files, "src/lib.rs", (content) =>
      content.replace(", Word", ""),
    );

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", false);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).not.toHaveProperty("masp");
    expect(res.body).not.toHaveProperty("commitment");
    expect(res.body).not.toHaveProperty("kind");
    expect(res.body).not.toHaveProperty("manifest");
    expect(res.body).not.toHaveProperty("readOnly");
    expect(res.body).not.toHaveProperty("files");
  });

  it("compiles a counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "account-component");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a count-reader", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "count-reader";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "account-component");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a counter-note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "note");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a counter-script", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-script";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "transaction-script");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles an auth-component-no-auth", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/auth-component-no-auth`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "account-component");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles an auth-component-rpo-falcon512", async () => {
    const files = await readProjectFiles(
      `${basicWalletDir}/auth-component-rpo-falcon512`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "account-component");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a basic-wallet", async () => {
    const files = await readProjectFiles(`${basicWalletDir}/basic-wallet`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "account-component");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a basic-wallet-tx-script", async () => {
    const files = await readProjectFiles(basicWalletDir);
    const entrypoint = "basic-wallet-tx-script";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "transaction-script");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a bank-account", async () => {
    const files = await readProjectFiles(`${bankDir}/bank-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "account-component");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a deposit-note", async () => {
    const files = await readProjectFiles(bankDir);
    const entrypoint = "deposit-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "note");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a withdraw-request-note", async () => {
    const files = await readProjectFiles(bankDir);
    const entrypoint = "withdraw-request-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "note");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles an init-tx-script", async () => {
    const files = await readProjectFiles(bankDir);
    const entrypoint = "init-tx-script";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("kind", "transaction-script");
    expect(res.body).toHaveProperty("manifest");
  });
});

// A build script that looks for a way into the cache it builds against: every
// file there that isn't the build user's own (in the image, the hard links to
// the image's warm cache), opened for writing. It writes nothing, and always
// fails the build, so its report comes back in `stderr`.
const CACHE_PROBE_BUILD_RS = `
use std::{env, fs, os::unix::fs::MetadataExt, path::Path};

fn probe(dir: &Path, me: u32, foreign: &mut u32, writable: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if meta.is_dir() {
            probe(&path, me, foreign, writable);
        } else if meta.is_file() && meta.uid() != me {
            *foreign += 1;
            if fs::OpenOptions::new().append(true).open(&path).is_ok() {
                writable.push(path.display().to_string());
            }
        }
    }
}

fn main() {
    let me = fs::metadata(env::var("OUT_DIR").unwrap()).unwrap().uid();
    let (mut foreign, mut writable) = (0, Vec::new());
    for root in ["CARGO_TARGET_DIR", "CARGO_HOME"] {
        if let Ok(dir) = env::var(root) {
            probe(Path::new(&dir), me, &mut foreign, &mut writable);
        }
    }
    panic!("cache probe: {foreign} foreign files, {} writable {:?}", writable.len(), writable.iter().take(3).collect::<Vec<_>>());
}
`;

describe("POST /compile build isolation", () => {
  // In the image most of a build's cache is hard links to the image's warm
  // cache: a link the build user could write would change that cache for
  // every later build. On the host every file is the build's own, so there is
  // nothing foreign to find.
  it("gives build code no file of the warm cache it can write", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    editProjectFile(files, "build.rs", () => CACHE_PROBE_BUILD_RS);

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", false);
    expect(res.body.stderr).toMatch(/cache probe: \d+ foreign files/);
    expect(res.body.stderr).toContain("foreign files, 0 writable");
  });
});

describe("POST /compile masm", () => {
  it("leaves the masm out unless asked", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("masm");
  });

  it("returns the release build's masm with masm: true", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const plain = await api.post("/compile").send({ files });

    const res = await api.post("/compile").send({ files, masm: true });

    expect(res.status).toBe(200);
    expect(res.body.masm.source).toContain(
      'namespace "miden:counter-contract/counter-contract@0.1.0"',
    );
    expect(res.body.masm.source).toContain('pub proc "increment-count"');
    // Emitting the masm doesn't change the package.
    expect(res.body.commitment).toBe(plain.body.commitment);
    expect(res.body.masp).toBe(plain.body.masp);
  });

  it("returns the entrypoint's masm in a workspace", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "count-reader";

    const res = await api
      .post("/compile")
      .send({ files, entrypoint, masm: true });

    expect(res.status).toBe(200);
    expect(res.body.masm.source).toContain(
      'namespace "miden:count-reader/count-reader@0.1.0"',
    );
  });

  it("has no masm when the build fails", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    editProjectFile(files, "src/lib.rs", (content) =>
      content.replace(", Word", ""),
    );

    const res = await api.post("/compile").send({ files, masm: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", false);
    expect(res.body).not.toHaveProperty("masp");
    expect(res.body).not.toHaveProperty("masm");
  });
});

describe("POST /compile readOnly", () => {
  it("tells the counter-contract's getter from its state change", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    const component = '::"miden:counter-contract/counter-contract@0.1.0"';
    expect(res.body.readOnly).toEqual({
      // Reads the count map through `active_account::get_map_item`.
      [`${component}::"get-count"`]: true,
      // Writes it through `native_account::set_map_item`.
      [`${component}::"increment-count"`]: false,
      [`${component}::init`]: true,
    });
  });
});

describe("POST /compile returned files", () => {
  it("echoes the sources with the lockfile it created", async () => {
    const { "Cargo.lock": _, ...files } = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    const { "Cargo.lock": cargoLock, ...sources } = res.body.files;
    expect(sources).toEqual(files);
    expect(cargoLock).toContain('name = "counter-contract"');
  });

  it("returns the lockfile it was sent", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.lock"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual(files);
  });

  // The version a lockfile pins smallvec at, a warm crate every build uses.
  const smallvecVersion = (cargoLock: string) =>
    cargoLock.match(/name = "smallvec"\nversion = "([^"]+)"/)?.[1];

  // Builds run `--offline` first; a crate the image never downloaded makes that
  // fail, and the build runs again online. The lockfile stays, so the retry
  // downloads only the new crate and keeps the warm pins. Resolving fresh
  // would download a newer release of a warm crate when there is one, and
  // every offline resolution after it in the container, the re-resolution
  // below included, would pick that release over the warm one.
  it("builds with a dependency the cache doesn't have", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const warmSmallvec = smallvecVersion(projectFile(files, "Cargo.lock"));
    expect(warmSmallvec).toBeDefined();
    editProjectFile(files, "Cargo.toml", (content) =>
      content.replace(
        "[dependencies]\n",
        '[dependencies]\nnohash-hasher = { version = "0.2", default-features = false }\n',
      ),
    );
    expect(files["Cargo.toml"]).toContain("nohash-hasher");

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("masp");
    expect(res.body.files["Cargo.lock"]).toContain('name = "nohash-hasher"');
    expect(smallvecVersion(res.body.files["Cargo.lock"])).toBe(warmSmallvec);
  });

  // A lockfile pinning another version of a warm crate (here smallvec 1.15.0,
  // which no build downloads) fails offline. `warmLockfile` re-resolves it
  // against the downloaded crates instead of downloading and rebuilding.
  it("re-resolves a stale lockfile offline with warmLockfile", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const warmSmallvec = smallvecVersion(projectFile(files, "Cargo.lock"));
    expect(warmSmallvec).toBeDefined();
    editProjectFile(files, "Cargo.lock", (content) =>
      content.replace(
        /(name = "smallvec"\nversion = )"[^"]+"(\nsource = "[^"]+"\nchecksum = )"[0-9a-f]+"/,
        '$1"1.15.0"$2"8917285742e9f3e1683f0a9c4e6b57960b7314d0b08d30d1ecd426713ee2eee9"',
      ),
    );
    expect(files["Cargo.lock"]).toContain('version = "1.15.0"');

    const res = await api.post("/compile").send({ files, warmLockfile: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("masp");
    expect(res.body.stderr).not.toContain("Downloaded");
    expect(smallvecVersion(res.body.files["Cargo.lock"])).toBe(warmSmallvec);
  });

  it("keys the lockfile by its path under the entrypoint", async () => {
    const entrypoint = "count-reader";
    const { [`${entrypoint}/Cargo.lock`]: _, ...files } =
      await readProjectFiles(counterContractDir);

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body.files[`${entrypoint}/Cargo.lock`]).toContain(
      'name = "count-reader"',
    );
    expect(res.body.files).not.toHaveProperty("Cargo.lock");
  });
});
