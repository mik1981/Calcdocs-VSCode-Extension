# ✨ Changelog

## 0.1.0
- First public release
- Formula refresh
- Value write-back
- Improved formula parsing

## 0.1.3
- Support for VSCode 1.109
- Added CodeLens to extract the effective value from complex `#define` statements

## 0.1.4
- Extended CodeLens to all C files

## 0.1.5
- Added the new CSV lookup signature: `csv(table, lookupValue, lookupColumn, valueColumn[, interpolation])`.
- Kept backward compatibility with the previous 3-argument form: `csv(table, lookupValue, valueColumn)`.
- Added optional interpolation modes when the lookup key is missing:
  - `none` / `exact` (default, no interpolation)
  - `linear` / `lerp`
  - `nearest` / `closest`
- `csv`, `table`, and `lookup` remain aliases of the same function.
