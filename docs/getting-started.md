# Getting Started

## Prerequisites

- VS Code 1.109+.
- A C/C++ workspace.
- Optional (recommended): `compile_commands.json` for higher-quality clangd data.

## First Run

1. Install CalcDocs.
2. Open your firmware/project folder.
3. Ensure `calcdocs.enabled` is `true`.
4. Open a `.c` file and verify:
   - CodeLens values
   - ghost values
   - hover details

## Suggested Smoke Test

Use [`test/src/test.c`](../test/src/test.c) and confirm values appear for:

- `PT100_NUM16(3)`
- `FINAL`, `LAST`
- `B(4)`, `CONT_SUM(3,4)`
- `STR(HELLO)`, `CAT(1,2)`

## Optional clangd Setup

- Keep `calcdocs.useClangd: true`
- Provide `compile_commands.json` in workspace/build/.vscode
- If clangd is active, CalcDocs augments it instead of duplicating hover output

