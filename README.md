# 🧮 CalcDocs - Formula Evaluator & C/C++ Constant Sync + Computed-Value Preview

**See the real values your compiler produces. Catch errors before they hit your firmware. Navigate formulas instantly.**

**CalcDocs is your real‑time engineering sanity checker.**  

It prevents subtle errors by showing you actual computed values — the ones you'd only catch *after* compiling — and keeps your formulas and C/C++ constants perfectly synchronized.

CalcDocs is a VS Code extension designed for firmware and embedded developers who work with engineering formulas in YAML and constants in C/C++.  
It helps you **keep formulas, documentation, and code always aligned** — automatically.

## 🔥 Why CalcDocs?
Writing engineering formulas and constants across YAML and C/C++ files often leads to hidden issues:
- A formula looks correct… but the final computed value is wrong.
- A `#define` expands to something unexpected.
- A constant silently overflows the target type.
- Documentation and code drift apart without anyone noticing.

CalcDocs solves all of this by showing you **what the compiler would really compute**, directly inside your editor.

## ⭐ Key Features (the real value)
- **Real computed values (compiler‑level evaluation)**  
  CalcDocs expands formulas and C/C++ definitions, showing the *final numeric value* you would see only after compiling.  
  This helps catch wrong formulas, overflow, unit errors, and “nonsense values” early.  
  *(Supports YAML formulas, `#define`, `const`, and nested dependencies.)* 

- **Instant navigation — “Go to Definition”**  
  Jump from any formula symbol or C/C++ constant straight to its definition, even across YAML ↔ C/C++ boundaries.

- **Hover previews everywhere**  
  Hover over a symbol to see:  
  - expanded formula  
  - substituted values  
  - evaluated numeric result  
  - source location (YAML or C/C++)

- **CodeLens with effective values**  
  CalcDocs adds CodeLens annotations showing the *real resolved value* of complex C/C++ constants — even when computed through multiple macro layers.

- **Mismatch detection**  
  Warns you when YAML values and computed C/C++ constants diverge beyond a threshold. 

- **Automatic YAML write‑back**  
  When formulas are refreshed, YAML `dati` and `value` fields are updated automatically.

---

![CalcDocs Demo](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Refresh.gif)
![CalcDocs Screenshot](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Definition.jpg)

CalcDocs helps firmware, embedded, and software teams keep formulas, documentation, and source constants aligned.

- GitHub project: [Calcdocs-VSCode-Extension](https://github.com/mik1981/Calcdocs-VSCode-Extension/)
- Issues: [Open an issue](https://github.com/mik1981/Calcdocs-VSCode-Extension/issues)

---

## 📑 Index

- [Install from `.vsix` File (Quick Guide)](#install-from-vsix-file-quick-guide)
- [Features](#features)
- [Commands](#commands)
- [Configuration](#configuration)
- [File Scanning Rules](#file-scanning-rules)
- [CSV Table Lookup](#csv-table-lookup)
- [Complex Formulas and Constants](#complex-formulas-and-constants)
- [Quick Example](#quick-example)
- [Contributing](#contributing)
- [Sponsor](#sponsor)
- [Roadmap](#roadmap)
- [License](#license)

---

## 📦 Install from `.vsix` File (Quick Guide)

If you wish, you can directly use the file `calcdocs-vscode-extension-0.1.5.vsix` to install it without going through the Marketplace.

**Graphical method (recommended):**

1. Open **Visual Studio Code**.
2. Go to the **Extensions** view (left sidebar icon or press `Ctrl+Shift+X`).
3. Click the three dots `...` at the top of the Extensions panel.
4. Select **Install from VSIX...**.
5. Choose the `.vsix` file and confirm.
6. Restart VS Code.

**Terminal method (optional):**

```bash
code --install-extension calcdocs-vscode-extension-0.1.5.vsix
```

**Verify the installation:**

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Search for `CalcDocs: Forza aggiornamento formule`.
3. If the command is visible, the extension has been installed correctly.

---

## 🚀 Features

- C/C++ source files always remain under your control; the extension only flags potential misalignments.
- Hover on formula symbols in YAML files.
- Optional fallback hover/definition providers for C/C++ (`calcdocs.enableCppProviders`).
- Go to definition for:
  - keys defined in `formula*.yaml` / `formulas*.yml`
  - `#define` and `const` symbols found in C/C++ files
- Formula expansion with known symbol values.
- Numeric evaluation when expressions can be fully resolved.
- Recursive resolution of complex C/C++ definitions (`#define` and `const` with dependencies).
- C/C++ CodeLens for composite definitions with computed numeric values.
- Mismatch detection between C/C++ constants and YAML computed values (warning lens when difference is significant).
- YAML write-back of `dati` and `value` fields on refresh.
- CSV/table lookups in formulas with named columns and optional interpolation.
- Status bar quick refresh and periodic background analysis.

---

## ⌨️ Commands

| Command | What it does |
| --- | --- |
| `CalcDocs: Forza aggiornamento formule` | Rebuilds index, recalculates formulas, and writes back YAML (`dati`, `value`) |
| `CalcDocs: Imposta intervallo scansione` | Sets periodic scan interval in seconds (`0` disables periodic scan/watchers) |
| Status bar button `CalcDocs` | Manual quick refresh |

---

## ⚙️ Configuration

Available workspace settings:

- `calcdocs.scanInterval` (number, default `0`)
- `calcdocs.ignoredDirs` (string array, folders excluded from analysis)
- `calcdocs.enableCppProviders` (boolean, default `true`, keeps C/C++ tools as primary)

---

## 🔍 File Scanning Rules

Formula files:

- `formula*.yaml`
- `formula*.yml`
- `formulas*.yaml`
- `formulas*.yml`

Code files:

- `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`

Activation events:

- `onStartupFinished`
- `onLanguage:yaml`

---

## CSV Table Lookup

Use this in YAML formulas to read values from adjacent CSV files.

Preferred form:

```yaml
NTC_ADC_10K_25C:
  formula: csv("ntc_10k_table.csv", "25", "temp_c", "resistance_ohm")
```

With interpolation:

```yaml
NTC_ADC_10K_22C:
  formula: csv("ntc_10k_table.csv", "22", "temp_c", "resistance_ohm", "linear")
```

Legacy compatible form:

```yaml
NTC_ADC_10K_25C_OLD:
  formula: csv("ntc_10k_table.csv", "25", "resistance_ohm")
```

In summary, the available forms to use this function are:

1. `csv(table, lookupValue, lookupColumn, valueColumn[, interpolation])`.
2. `csv(table, lookupValue, valueColumn)`.

For the interpolation option, the available values are:

  - `none` / `exact` (default, no interpolation)
  - `linear` / `lerp`
  - `nearest` / `closest`

Note: `csv`, `table`, and `lookup` remain aliases of the same function.

---

## Complex Formulas and Constants

This section describes what is currently supported by the evaluator and parser.

Complex formulas in YAML:

- Arithmetic expressions with operators like `+`, `-`, `*`, `/`, `%`, parentheses, and ternary `?:`.
- Bitwise and comparison operators are accepted by the evaluator, as long as the final result is a finite number.
- Recursive symbol resolution across dependent `#define` constants (for example `B = A * 2`, `C = B + 3`).
- Math functions and constants (case-insensitive aliases are available), including:
  - `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`
  - `sqrt`, `pow`, `log`, `log10`, `log2`, `exp`, `abs`, `min`, `max`, `round`, `floor`, `ceil`
  - degree helpers: `deg2rad`, `rad2deg`, `sind`, `cosd`, `tand`, `asind`, `acosd`, `atand`
  - constants: `pi`, `tau`, `e`
- Inline table lookups through `csv(...)`, `table(...)`, `lookup(...)`, including optional interpolation modes (`none`, `linear`, `nearest`).

C/C++ constants currently extracted:

- Object-like `#define` with one-line expression:
  - `#define NAME EXPR`
- `const`/`static const` scalar declarations with these types:
  - `long`, `int`, `short`, `char`, `float`, `double`
  - `int*_t`, `uint*_t` forms (e.g. `int32_t`, `uint16_t`)
  - optional `unsigned` prefix

Current limits:

- Function-like macros are ignored (for example `#define F(x) ...`).
- Multi-line macros are not parsed as a single expression.
- `const` declarations with unsupported types (for example pointers, structs, custom typedefs not matching supported patterns) are ignored for numeric extraction.
- Expressions that do not reduce to a finite numeric value are left unresolved.

---

## 🧪 Quick Example

```yaml
MAX_SPEED:
  formula: RPM * WHEEL_RADIUS * 0.10472
  unit: m/s
  value: 12.5

RPM:
  value: 1000

WHEEL_RADIUS:
  value: 0.2
```

```c
#define SPEED_LIMIT_FACTOR (RPM / 2 + 10)
const int MAX_SPEED = SPEED_LIMIT_FACTOR * 2;
```

CalcDocs can expand and resolve these symbols, show computed values in hover/CodeLens, and navigate to their definitions.

---

## 🤝 Contributing

Contributions are welcome, especially for:

- parser improvements
- diagnostics
- tests
- developer experience

---

## ❤️ Sponsor

If you find this extension useful, consider sponsoring the project.

[![PayPal](./resources/paypal.png)](https://www.paypal.me/gianmichelepasinelli)

---

## 🗺️ Roadmap

Planned improvements:

- YAML schema validation
- stronger expression parsing
- more automated tests for YAML write-back
- configurable include/exclude paths

---

## 📄 License

[![MIT License](./resources/mit-license.png)](./LICENSE.md)
