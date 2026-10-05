//! Every Hookscript fixture the fork tests and CU bench load must pass the linked VM's `verify`
//! (catches header drift when the VM's cost table changes).
#![cfg(feature = "hookscript")]
use std::{fs, path::Path};

#[test]
fn fork_fixtures_verify_under_the_linked_vm() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("fork/fixtures");
    let mut n = 0;
    for e in fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path();
        if p.extension().is_some_and(|x| x == "hex") {
            let h = fs::read_to_string(&p).unwrap();
            let h = h.trim();
            let bytes: Vec<u8> = (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect();
            let info = hookscript_vm::verify(&bytes).unwrap_or_else(|e| panic!("{}: {}", p.display(), e.name()));
            assert!(info.gas_max <= hookscript_vm::GAS_LIMIT, "{}", p.display());
            n += 1;
        }
    }
    assert!(n >= 6, "fixtures missing");
}
