//! Runs racing on a store that doesn't exist yet must all get past building the
//! client. Each run is then rejected (exit 2) for its unreadable package, before
//! it touches the network; a run that exits 1 lost the race to create the store.

use std::process::{Command, Output};
use std::thread;

const RUNS: usize = 8;

#[test]
fn concurrent_runs_on_a_new_store_all_build_the_client() {
    // A directory of its own, empty: no store yet.
    let dir =
        std::env::temp_dir().join(format!("miden-verifier-store-race-{}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let masp_path = dir.join("not-a-package.masp");
    std::fs::write(&masp_path, b"not a package").unwrap();

    let runs: Vec<Output> = thread::scope(|scope| {
        let handles: Vec<_> = (0..RUNS)
            .map(|_| {
                scope.spawn(|| {
                    Command::new(env!("CARGO_BIN_EXE_miden-verifier"))
                        .current_dir(&dir)
                        .args(["--network-id", "mtst", "--resource-id"])
                        .arg(format!("0x{}", "5a".repeat(32)))
                        .arg("--masp-path")
                        .arg(&masp_path)
                        .output()
                        .unwrap()
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect()
    });

    for run in runs {
        let stderr = String::from_utf8_lossy(&run.stderr);
        assert_eq!(run.status.code(), Some(2), "{stderr}");
        assert!(stderr.contains("invalid package"), "{stderr}");
    }
    std::fs::remove_dir_all(&dir).unwrap();
}
