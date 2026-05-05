# Case 11: Advanced C Types and Operators

Demonstrates:
- `sizeof` for primitives, arrays, structs, pointers, qualified types.
- `const`, `volatile` variables and propagation in expressions/functions.
- Pointers: dereference, arithmetic, null.
- Functions with const/volatile/pointer params, showing ghost arg expansion.
- `switch` on const/enum with cases, intelligent value selection.

Open `input.c` in VSCode with CalcDocs extension to see ghost values with type awareness (e.g., `safe_deref(&VOL_VAL)` ghosts as `safe_deref(0xDEADBEEF)`, pointer derefs show values if known).

Expected values in `expected.yaml` assume 32-bit arch.

Test with runner or manually refresh diagnostics.

