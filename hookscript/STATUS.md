# Hookscript status

_Updated 2026-10-04 (in progress)._

## Ready for ENGINE now
- `vm/` crate `hookscript-vm` (lib `hookscript_vm`) builds for `sbpf-solana-solana` with the ENGINE-SPEC toolchain line.
  It has no dependencies. The final signature is `run(code, &Ctx, globals, wallet_src, wallet_dst) -> Result<Verdict, VmError>`, plus `verify`,
  `run_metered`, `format_reason` and `price_e6_from_sqrt_q64`. Ctx is documented in SPEC.md §8.
- Host tests: `cd vm && cargo test --release` passes (12 tests, plus 3M-iteration random-bytes fuzz with 0 panics).

## In progress
Compiler, TS interpreter, parity, examples, fuzzer and drafter.
