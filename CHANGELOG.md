# Changelog

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

