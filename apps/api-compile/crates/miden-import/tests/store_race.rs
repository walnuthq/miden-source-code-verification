//! Runs racing on a store that doesn't exist yet must all get past building the
//! client. Each run is then turned away (exit 2) for an ID that names nothing,
//! before it touches the network; a run that exits 1 lost the race to create the
//! store.

use std::process::{Command, Output};
use std::thread;

const RUNS: usize = 8;

#[test]
fn concurrent_runs_on_a_new_store_all_build_the_client() {
    // A directory of its own, empty: no store yet.
    let dir = std::env::temp_dir().join(format!("miden-import-store-race-{}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();

    let runs: Vec<Output> = thread::scope(|scope| {
        let handles: Vec<_> = (0..RUNS)
            .map(|_| {
                scope.spawn(|| {
                    Command::new(env!("CARGO_BIN_EXE_miden-import"))
                        .current_dir(&dir)
                        .args(["--network-id", "mtst", "--resource-id", "not-an-id"])
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
    std::fs::remove_dir_all(&dir).unwrap();

    for run in runs {
        let stderr = String::from_utf8_lossy(&run.stderr);
        assert_eq!(run.status.code(), Some(2), "{stderr}");
    }
}
