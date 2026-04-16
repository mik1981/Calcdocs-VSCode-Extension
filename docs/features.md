# Features

## C/C++ Value Intelligence

- Computed value previews for:
  - `#define` object-like and function-like macros
  - global/local declarations with assignments
  - chained expressions with casts and conditional symbols
- Ghost values in `.c` files for fast inline reading.
- Hex + decimal display for integer-friendly workflows.

## Hybrid Provider Integration

- `clangd` wrapper with AST request support.
- IntelliSense wrapper with additive hover behavior.
- Dynamic fallback to parser mode when external backends are missing.

## Formula System

- `formulas.yaml` evaluation with:
  - dependency ordering
  - explain steps
  - mismatch diagnostics vs C/C++ symbols
  - optional write-back support

## Dimensional & Unit Support

- Compatible unit math checks.
- Dimensional mismatch diagnostics.
- Output unit conversion for supported families.

## Diagnostics & Navigation

- Conditional macro ambiguity detection.
- Cast overflow detection in hover/CodeLens.
- Go-to-definition across C/C++ and YAML entries.

## Performance

- LRU cache for preprocessing-heavy symbol extraction.
- Incremental analysis scheduling.
- Resource monitor integration (CPU/RAM).

