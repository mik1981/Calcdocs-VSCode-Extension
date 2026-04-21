# Changelog

## [0.2.2]

- Added more structured example under `examples` dir.
- Switch `calcdocs.openTestFolder` to open `examples` dir

## [0.2.1]

- Fix README.md

## [0.2.0]

### Added

- Unified macro-functional architecture around:
  - dimensional calculations
  - real-time calculations
  - cache-aware symbol analysis
- Hybrid backend strategy:
  - clangd wrapper with AST request support (`textDocument/ast`)
  - IntelliSense (cpptools) additive hover wrapper
  - parser fallback when external providers are unavailable
- Ghost value coverage for local declarations in `.c` files (including inline comments).
- Macro expansion support improvements:
  - token pasting (`##`)
  - stringizing (`#`)

### Changed

- Hover wrapper now contributes only CalcDocs-specific extra data when external providers are active.
- `calcdocs.useClangd` reconfiguration now updates backend at runtime.
- Documentation refreshed for Marketplace presentation.
- Test system consolidated under Vitest with stable `test/unit` + `src/**/__tests__` suites.

### Fixed

- Ghost values no longer suppressed on lines containing trailing comments.
- Local declaration extraction now supports cases needed by `test/src/test.c`.
- Legacy node-test suites converted to Vitest to avoid false "no suite" failures.

## [0.1.12]

- Resolve write-back issue affecting specific cases.
- Expanded test files with additional cases to improve coverage.
- README updates.

## [0.1.11]

- Fix false "multiple conditional definitions" warnings across source files.
- Add semantic deduplication of define variants.
- Add parser regression tests for cross-file deduplication.

## [0.1.10]

- Active-file analysis improvements and runtime stability updates.

## [0.1.9]

- `openTestFolder` command improvements.
- CodeLens cast overflow and mismatch refinements.

## [0.1.8]

- Recursive preprocessor condition resolution and improved hover/CodeLens behavior.

## [0.1.7]

- Hover macro evaluation and hexadecimal value display.

## [0.1.6]

- Conditional ambiguity tracking and stack-safety protections.

## [0.1.5]

- Extended CSV lookup signatures and interpolation modes.

## [0.1.4]

- CodeLens support extended to all C files.

## [0.1.3]

- VS Code 1.109 compatibility update.

## [0.1.0] - 02/27/2026

- First public release.

