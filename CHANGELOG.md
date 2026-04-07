# Changelog

## 0.1.12
- Resolve write-back issue affecting specific cases
- Expanded test files with additional cases to improve coverage
- Update README.md

## 0.1.11
- Fixed false "multiple conditional definitions" warnings across different source files (shared includes).
- Added semantic deduplication of define variants (condition + expr) in cppParser.ts.
- collectDefinesAndConsts now returns already deduplicated defineVariants.
- Added regression tests in cppParser.test.ts: cross-file deduplication + distinct variant preservation.
- Updated package.json test script to include new tests.
- Verified: \`npm run test:engine\` (9 passed, 0 failed).

## 0.1.10
- **Extension**: Active C++ file analysis on editor switch/save, full config change reactivity, improved resourceMonitor lifecycle.
- **General**: VSCode 1.109+ stability, LRU cache tuning, output channel enhancements.

## 0.1.9 
- **StatusBar**: YAML parse errors with line/col position, stack degraded indicators, localized tooltips with full stats (depth/cycles/prunes).
- **Commands**: `openTestFolder` now auto-opens test/ + test.c file.
- **CodeLensProvider**: Cast overflow diagnostics in lenses, precise mismatch threshold (0.01%), cleaner open-formula links.

## 0.1.8
- Recursive resolution of #if/#elif/#else/#endif constructs (condition-aware symbol extraction).
- **CodeLens**: brace-aware parsing, formatted c-like previews (`#define NAME 1'024`), refined YAML mismatch warnings.
- **Hover**: full function-macro call detection/extraction (cursor-aware), RHS macro eval in #define lines, multi-definition lists (conditional/in-file), inherited ambiguity display.
- **cppParser**: mega-content include resolution, 2nd-pass conditional variant tracking, include-guard awareness.
- Support for line continuation (`\`) and improved parenthesis handling.

## 0.1.7
- Enhanced hover provider with comprehensive documentation and code organization.
- Added support for RHS (right-hand side) macro evaluation in #define statements: hovering over macro calls within the definition now shows computed results.
- Enhanced expression evaluation: improved parenthesis stripping logic to avoid removing necessary grouping in arithmetic expressions.
- Support line concatenation using the '\' backslash line continuation C-operator.
- Added hexadecimal display in hover: for integer values, shows both decimal and hexadecimal format (e.g., `1024 (0x0400)`) with 4-digit grouping.

## 0.1.6
- Added runtime CPU and memory monitoring in the status bar.
- Added `calcdocs.toggleEnabled` command and `calcdocs.enabled` setting to enable or disable extension behavior on demand.
- Added configurable runtime status visibility: always shown or shown only above a CPU threshold (`calcdocs.resourceStatusMode`, `calcdocs.resourceCpuThreshold`).
- Added support for C/C++ function-like macros (e.g., `#define MY_MACRO(x) ((x) * 2)`) with parameter expansion and recursive resolution.
- Added configurable thousands separator for formatted numbers (`calcdocs.thousandsSeparator`): none, space, dot (⋅), comma, apostrophe, narrow no-break space.
- Added full preprocessor conditional tracking (`#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`) with condition-aware symbol resolution.
- Added multiple definition handling: symbols with different values depending on preprocessor conditions are tracked and ambiguity is properly detected.
- Added ambiguity propagation: symbols that depend on ambiguous definitions are also marked as ambiguous to prevent incorrect evaluations.
- Added function-like macro evaluation in hover: hovering over macro calls like `MY_MACRO(5)` shows the computed result with proper parameter expansion.
- Added enhanced hover diagnostics:
  - Conditional value indicators showing which preprocessor condition applies
  - Multiple definitions warnings in current file and across workspace
  - Inherited ambiguity detection for dependent symbols
- Added enhanced CodeLens with ambiguity warnings for complex definitions affected by preprocessor conditions.
- Added improved "Go to Definition" that returns multiple locations when a symbol has multiple conditional definitions.
- Added stack safety monitoring:
  - Circular dependency detection with cycle samples in output log
  - Depth limit protection (96 levels) to prevent stack overflow
  - Degraded mode indicators in status bar when resolution is limited
- Added symbol resolution statistics tracking: current depth, max depth, cycle count, and pruned branches.
- Added new fields to formula entries: `labels` array with `table_lookup` and `complex_expression` tags.
- Added localization support for stack safety warnings (Italian included).

## 0.1.5
- Added the new CSV lookup signature: `csv(table, lookupValue, lookupColumn, valueColumn[, interpolation])`.
- Kept backward compatibility with the previous 3-argument form: `csv(table, lookupValue, valueColumn)`.
- Added optional interpolation modes when the lookup key is missing:
  - `none` / `exact` (default, no interpolation)
  - `linear` / `lerp`
  - `nearest` / `closest`
- `csv`, `table`, and `lookup` remain aliases of the same function.

## 0.1.4
- Extended CodeLens to all C files

## 0.1.3
- Support for VSCode 1.109
- Added CodeLens to extract the effective value from complex `#define` statements

## 0.1.0
- First public release
- Formula refresh
- Value write-back
- Improved formula parsing

