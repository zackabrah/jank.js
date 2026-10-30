# Capture completeness and timestamp diagnostics

Source verification on 2026-10-30, Apple M3 Max, Node 26.12.1, pnpm 11.24.0.
These changes are ahead of the archived rewrite.3 preview; source recordings now use schema 5.

- Behavioral tests first reproduced absent rejection diagnostics, dropped retention identities,
  missing coverage analysis and ignored sampling configuration.
- `pnpm check`, `pnpm test:coverage` and `pnpm test:package` passed. The isolated package consumer
  exercises coverage and inspection exports without workspace source files.
- Focused panel/GPU browser checks passed: 59 cases across Chromium, Firefox and WebKit. Seven
  cases were skipped: three opt-in benchmarks and four timestamp hardware checks on unsupported
  Chromium/Firefox. WebKit passed independent raw readback and bounded finalization checks.
- Twelve panel/GPU visual cases passed. Capture baselines were intentionally updated; active
  narrow capture baselines were added. Narrow Chromium and desktop WebKit images were inspected.
  The capture browser regression also passes axe at 360px width.
- `pnpm bench` completed: median added cost 0.183µs/frame for boundaries, 1.360µs for eight scopes,
  1.786µs for manual capture with eight scopes, and 9.665µs including amortized serialization.
  These are local synthetic Node measurements, including copying/GC noise. They exclude adapters,
  GPU execution, panel work and browser paint; they do not estimate production overhead or speedup.

The 16,384-pass retention cap can exhaust before the 6,000-frame cap. Controlled tests reproduce
that loss and verify explicit frame markers, remaining capacity, bounded zero-detail storage,
rejected-pair accounting and round-trip exports. The reported production runs were not supplied
as raw recordings, so their specific 1,319/1,443 coverage loss has not been causally confirmed.

Coverage means complete interval evidence per recorded CPU frame. Sampling gaps remain gaps.
Missing evidence has no inferred cause. Tests inject missing, zero, reversed and out-of-range
timestamps; they do not establish the cause or frequency of hardware timestamp rejection.

Named production passes, A/B automation and unified panel stop/finalize/export remain separate
integration work. No production project, archived tarball or published package was changed.
