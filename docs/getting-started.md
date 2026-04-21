# Getting Started

## Prerequisites

- VS Code 1.109+.
- A C/C++ workspace.
- Optional (recommended): `compile_commands.json` for higher-quality clangd data.

## First Run

1. Install CalcDocs.
2. Open your firmware/project folder.
3. **Optional: Create `formulas.yaml`** (see [Formula YAML Guide](formulas-yaml.md)).
4. Ensure `calcdocs.enabled` is `true`.
5. Open a `.c`/`.yaml` file and verify:
   - CodeLens values
   - ghost values
   - hover details
   - Formula sync (if YAML present)

## Suggested Smoke Test

Use [`examples/full_showcase/src/app.c`](../examples/full_showcase/src/app.c) and confirm values appear for constants and defines:

## Optional clangd Setup

- Keep `calcdocs.useClangd: true`
- Provide `compile_commands.json` in workspace/build/.vscode
- If clangd is active, CalcDocs augments it instead of duplicating hover output

