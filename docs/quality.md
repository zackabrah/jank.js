# Code quality policy

The goal is understandable, dependable code. A green linter is evidence of policy compliance,
not a certificate of good architecture. These choices are explicit project decisions, not a
claim that one universal "industry standard" specifies every detail.

## Automated now

| Gate                                   | Enforces                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pinned Biome 2.6.4 recommended rules   | Broad correctness, suspicious-code, accessibility and style checks where supported                                                                                             |
| Additional error-level rules           | No explicit `any`, non-null assertions, parameter reassignment, nested ternaries, import cycles, unhandled/misused promises; braces and one variable declaration per statement |
| Cognitive complexity ≤ 15              | Flags difficult branching for redesign or a justified local exception                                                                                                          |
| At most four parameters                | Encourages named options when arguments encode several independent choices                                                                                                     |
| Package/layer import restrictions      | junkui cannot import jank/renderers; data layers cannot import UI/adapters                                                                                                     |
| TypeScript strict mode                 | Null safety, checked indexing, exact optional properties, unused/unreachable code and incomplete return paths                                                                  |
| Separate browser-free core compilation | Measurement/capture/analysis/loading cannot accidentally rely on DOM or Node globals                                                                                           |
| Contract examples and negative cases   | Intended integrations type-check; invalid states, mutation and fake scope tokens are rejected                                                                                  |
| Tooling-policy tests                   | Real Biome invocations reject representative violations and allow ordinary readable code                                                                                       |

Collection, capture, files and public composition have deterministic Vitest tests, seeded
fast-check properties, real host-loop/download tests in Chromium/Firefox/WebKit, and isolated
package runtime/type consumers. Coverage floors are 90% per implemented profiler file for statements,
branches, functions and lines. These floors support behavioral tests; they do not replace
reviewing their assertions. `pnpm bench` measures public collection, capture and serialization
workloads and records their limits.

Junkui behavior is tested against real DOM and native controls in Chromium, Firefox and
WebKit. Each enabled gallery panel receives an axe check. Separate visual comparisons cover
desktop and narrow screens on macOS 26 arm64; Linux CI retains all interaction/accessibility
checks. No DOM mocks or empty Node coverage gate stand in for those browser tests.

Chromium visual tests retain a macOS monospace font override (`Menlo`) for the page lifetime.
The pinned Chromium 153 otherwise switches Courier/Menlo during full-page screenshots
([upstream issue](https://github.com/microsoft/playwright/issues/42962)). A capture/navigation
regression protects this workaround. Baselines use the stable mapping; pixel tolerances and
application styles are unchanged. Recheck the workaround when upgrading Playwright.

Implementation follows test-driven development: first reproduce behavior with a failing test,
then implement it, then simplify while retaining the passing tests. Browser-discovered failures
receive deterministic regressions when possible.

The two promise rules are individually enabled nursery rules in the pinned version. They are
not a replacement for TypeScript or lifecycle tests. Re-evaluate them when upgrading Biome.

Formatting uses two spaces, semicolons, double quotes and a 100-column target. Imports are
organized automatically; related statements stay together. No blank line is required between
every statement. No mandatory comment above every function. Meaningful domain constants are
named; literals such as zero, array offsets, CSS values and discriminants do not need pointless
aliases to satisfy a blanket magic-value rule.

There are no hard file/function length caps. They encourage superficial splitting when used
alone. Functions should have one clear job; modules should own a coherent set of decisions.
Review large modules for multiple responsibilities rather than compressing code or generating
shallow helpers to pass a numeric gate. Tests may use longer readable scenarios.

## Human review

Ask these questions on every implementation slice:

1. Can a reader understand names, units, inputs, output and failure behavior without jumping
   through several forwarding functions?
2. Is the state owner clear, and can another module mutate or invalidate it unexpectedly?
3. Does each abstraction hide real knowledge? Is deduplication sharing an invariant rather
   than just similar syntax?
4. Can each module be tested through meaningful behavior? Are invariants enforced at boundaries
   instead of revalidated repeatedly inside trusted loops?
5. Are disposal, replacement, cancellation, empty/unavailable data, browser failures and stale
   asynchronous completions addressed?
6. Is the public API smaller than the implementation, and are internal details kept private?
7. Are numeric units, frame identity, ownership, copying and inclusive timings explicit?
8. Do controls preserve semantics, keyboard focus, labels, contrast and the current appearance?
9. Does the change preserve host ownership, local-only data, and measurement honesty?
10. Is any claimed performance improvement supported by comparable measurements?

Comments explain contracts, non-obvious reasons, units or tradeoffs. They do not narrate syntax.
Prefer early returns and direct loops where they clarify control flow. Use `map`/`filter` when
they describe a transformation well; do not ban one style merely to force another.

Type assertions are not runtime validation. Do not introduce double casts to satisfy a type
checker. Small generic helpers are appropriate when they preserve a real input/output
relationship; a generic application framework is not.

## Exceptions and later gates

A suppression belongs beside the exceptional code with a concrete reason. Do not weaken the
workspace policy for one awkward call. Conversely, reconsider a rule if it repeatedly demands
less readable code. Review both the rule and the code rather than accumulating suppressions.

With later implementation, extend runtime package-consumer tests and browser cases; add axe and focused keyboard tests;
visual comparisons at the existing panel sizes; offline/network checks; and measured overhead
comparisons. Coverage floors start from the implemented slices and protect meaningful branch
coverage, not from fabricated tests or the old source tree's percentages.

Run Knip after actual entry points and optional exports exist. A dev-stack-only foundation
intentionally has tools which are not used by runtime code yet. CI must not claim a runtime,
browser, package or benchmark gate exists until it actually executes one.

Sources for the tooling, not a substitute for design judgment:
[Biome rules and linting](https://biomejs.dev/linter/),
[cognitive complexity](https://biomejs.dev/linter/rules/no-excessive-cognitive-complexity/javascript/),
[TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html).
