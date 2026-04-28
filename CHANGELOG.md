# Changelog

## [0.2.5] - 04/28/2026

- Removed unused parameters and commands
- Extended calcdocs.generateFormulaHeader to all formula*.yaml files in the workspace
- Fixed license badge in README.md
- Added example case 10_c_operators

- Support to c operator like sizeof, _Alignas, _Alignof, _Static_assert, _Bool, _Complex, _Imaginary e #undef

## [0.2.4] - 04/23/2026

- Auto-detect hex or binary view format
- Added example case 09_function_calls

## [0.2.3] - 04/22/2026

- Added enum support
- Fixed unit handling in the formula*.yaml evaluator
- Fixed case-sensitive path in not Windows enviroment
- Fixed README.md quick menu table

## [0.2.2] - 04/21/2026

- Added more structured example under `examples` dir.
- Switch `calcdocs.openTestFolder` to open `examples` dir

## [0.2.1] - 04/21/2026

- Fix README.md

## [0.2.0] - 04/16/2026

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

## [0.1.12] - 04/07/2026

- Resolve write-back issue affecting specific cases.
- Expanded test files with additional cases to improve coverage.
- README updates.

## [0.1.11] - 04/03/2026

- Fix false "multiple conditional definitions" warnings across source files.
- Add semantic deduplication of define variants.
- Add parser regression tests for cross-file deduplication.

## [0.1.10] - 03/31/2026

- Active-file analysis improvements and runtime stability updates.

## [0.1.9] - 03/24/2026

- `openTestFolder` command improvements.
- CodeLens cast overflow and mismatch refinements.

## [0.1.8] - 03/17/2026

- Recursive preprocessor condition resolution and improved hover/CodeLens behavior.

## [0.1.7] - 03/11/2026

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

