//! Compiling the example projects that the fixtures are assembled from.

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};
use miden_client::utils::Deserializable;
use miden_client::vm::Package;

/// Compiles an example project with `cargo miden build --release` and reads back
/// the resulting package. Mirrors `apps/api-compile/src/lib/cargo-miden.ts`: the
/// artifact lands at `$MIDENC_TARGET_DIR/release/<project>.masp`.
///
/// Runs with a scrubbed environment — see the `env_remove` calls below for why
/// inheriting cargo's and rustup's own variables breaks the nested build.
fn build_package(
    examples_dir: &Path,
    group: &str,
    project: &str,
    midenc_target_dir: &Path,
) -> Result<Package> {
    let project_dir = examples_dir.join(group).join(project);
    let target_dir = midenc_target_dir.join(project);

    eprintln!("Building {group}/{project}…");
    let output = Command::new("cargo")
        .args(["miden", "build", "--release"])
        .current_dir(&project_dir)
        .env("MIDENC_TARGET_DIR", &target_dir)
        // Cargo hands its own toolchain down to whatever it launches, and a
        // nested cargo honours it: `RUSTUP_TOOLCHAIN` overrides a directory's
        // `rust-toolchain.toml` outright. Left in place, the examples build on
        // whichever channel was active wherever this tool was started from —
        // from `packages/test-utils` that is stable, and they need the nightly
        // they pin, so the build fails on the `-Z` flags `cargo miden` passes.
        // It only looks fine when the two happen to coincide, as they do when
        // this tool is run from its own crate directory. Clearing the variables
        // lets each project resolve its toolchain exactly as it would for
        // someone running `cargo miden build` in it by hand.
        //
        // `RUST_RECURSION_COUNT` goes with them: it is rustup's guard against
        // proxies invoking each other in a loop, and this nesting is deliberate.
        .env_remove("RUSTUP_TOOLCHAIN")
        .env_remove("RUSTUP_TOOLCHAIN_SOURCE")
        .env_remove("RUST_RECURSION_COUNT")
        // Each project also has to build into its own `target/`: that is where
        // `counter-contract` leaves the `generated-wit/` directory that
        // `count-reader`, `counter-note` and `counter-script` resolve their WIT
        // dependency against. An ambient `CARGO_TARGET_DIR` would redirect it
        // somewhere none of them look.
        .env_remove("CARGO_TARGET_DIR")
        .output()
        .with_context(|| format!("failed to run `cargo miden build` for {project}"))?;

    if !output.status.success() {
        bail!(
            "`cargo miden build` failed for {project}:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let masp_path = target_dir.join("release").join(format!("{project}.masp"));
    let package_bytes = std::fs::read(&masp_path)
        .with_context(|| format!("failed to read package at {}", masp_path.display()))?;
    Package::read_from_bytes(&package_bytes)
        .map_err(|err| anyhow!("failed to deserialize {project} package: {err}"))
}

/// Every example package the fixtures are built from.
pub struct Packages {
    pub auth_no_auth: Package,
    pub counter_contract: Package,
    pub count_reader: Package,
    pub counter_note: Package,
    pub counter_script: Package,
    pub basic_wallet: Package,
    pub auth_rpo_falcon512: Package,
}

impl Packages {
    /// Builds all of them, in dependency order.
    pub fn build(examples_dir: &Path, midenc_target_dir: &Path) -> Result<Self> {
        let build = |group, project| build_package(examples_dir, group, project, midenc_target_dir);

        // `counter-contract` comes first within its group: `count-reader`,
        // `counter-note` and `counter-script` each declare a WIT dependency on
        // `../counter-contract/target/generated-wit/`, which only exists once
        // the account component itself has been compiled.
        let auth_no_auth = build("counter-contract", "auth-component-no-auth")?;
        let counter_contract = build("counter-contract", "counter-contract")?;
        let count_reader = build("counter-contract", "count-reader")?;
        let counter_note = build("counter-contract", "counter-note")?;
        let counter_script = build("counter-contract", "counter-script")?;

        let basic_wallet = build("basic-wallet", "basic-wallet")?;
        let auth_rpo_falcon512 = build("basic-wallet", "auth-component-rpo-falcon512")?;

        Ok(Self {
            auth_no_auth,
            counter_contract,
            count_reader,
            counter_note,
            counter_script,
            basic_wallet,
            auth_rpo_falcon512,
        })
    }
}
