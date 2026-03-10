# 🧮 CalcDocs - Formula Evaluator & C/C++ Constant Sync + Computed-Value Preview

[![CI](https://badgen.net/vs-marketplace/v/convergo-dev.calcdocs-vscode-extension)](https://marketplace.visualstudio.com/items?itemName=convergo-dev.calcdocs-vscode-extension)

This extension is designed to enhance your embedded C/C++ workflow.  
For the best experience, we recommend installing the Microsoft C/C++ extension (ms-vscode.cpptools) to benefit from IntelliSense, code navigation and advanced language tooling.  
When combined with CMake Tools and Cortex‑Debug, this extension becomes a powerful part of a complete embedded toolchain inside VS Code.

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

- **Conditional #define support**  
  Full preprocessor condition tracking (`#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`) with multiple definition handling and ambiguity detection.

- **Function-like macro evaluation**  
  Hover over macro calls to see computed results with proper parameter expansion.

- **Stack safety monitoring**  
  Circular dependency detection and depth limit protection with degraded mode indicators.

- **Automatic YAML write‑back**  
  When formulas are refreshed, YAML `dati` and `value` fields are updated automatically.

---

![CalcDocs CodeLens Demo](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Refresh.gif)  
![CalcDocs Screenshot](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Definition.jpg)  
![CalcDocs Formula Refresh Demo](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Formulas.gif)  

CalcDocs helps firmware, embedded, and software teams keep formulas, documentation, and source constants aligned.

- GitHub project: [Calcdocs-VSCode-Extension](https://github.com/mik1981/Calcdocs-VSCode-Extension/)
- MarketPlace VSCode project: [Calcdocs-VSCode-Extension](https://marketplace.visualstudio.com/items?itemName=convergo-dev.calcdocs-vscode-extension)
- Issues: [Open an issue](https://github.com/mik1981/Calcdocs-VSCode-Extension/issues)

---

## 📑 Index

- [🧮 CalcDocs - Formula Evaluator \& C/C++ Constant Sync + Computed-Value Preview](#-calcdocs---formula-evaluator--cc-constant-sync--computed-value-preview)
  - [🔥 Why CalcDocs?](#-why-calcdocs)
  - [⭐ Key Features (the real value)](#-key-features-the-real-value)
  - [📑 Index](#-index)
  - [📦 Install from `.vsix` File (Quick Guide)](#-install-from-vsix-file-quick-guide)
  - [🚀 Features](#-features)
  - [⌨️ Commands](#️-commands)
  - [⚙️ Configuration](#️-configuration)
  - [🔍 File Scanning Rules](#-file-scanning-rules)
  - [📊 CSV Table Lookup](#-csv-table-lookup)
  - [🧠 Complex Formulas and Constants](#-complex-formulas-and-constants)
  - [🧪 Quick Example](#-quick-example)
  - [⭐ Recommended Extensions](#-recommended-extensions)
  - [🤝 Contributing](#-contributing)
  - [❤️ Sponsor](#️-sponsor)
  - [📄 License](#-license)

---

## 📦 Install from `.vsix` File (Quick Guide)

If you wish, you can directly use the file `calcdocs-vscode-extension-0.1.6.vsix` to install it without going through the Marketplace.

**Graphical method (recommended):**

1. Open **Visual Studio Code**.
2. Go to the **Extensions** view (left sidebar icon or press `Ctrl+Shift+X`).
3. Click the three dots `...` at the top of the Extensions panel.
4. Select **Install from VSIX...**.
5. Choose the `.vsix` file and confirm.
6. Restart VS Code.

**Terminal method (optional):**

```bash
code --install-extension calcdocs-vscode-extension-0.1.6.vsix
```

**Verify the installation:**

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Search for `CalcDocs: Force Formula Refresh`.
3. If the command is visible, the extension has been installed correctly.

**Project structure:**

```
calcdocs-vscode-extension/
│
├── src/                          # Extension source code (TypeScript)
│   ├── extension.ts               # Main entry point, activation/deactivation
│   │
│   ├── commands/                  # VS Code commands implementation
│   │   └── commands.ts            # Command handlers (forceRefresh, toggleEnabled, etc.)
│   │
│   ├── core/                      # Core business logic
│   │   ├── analysis.ts            # Main analysis orchestration, workspace scanning, YAML write-back
│   │   ├── config.ts              # Configuration management
│   │   ├── cppParser.ts           # C/C++ #define and const parsing
│   │   ├── csvTables.ts           # CSV table loading and lookup functions
│   │   ├── expression.ts          # Expression evaluation, token replacement, symbol resolution
│   │   ├── files.ts               # File system operations, recursive listing
│   │   ├── state.ts               # Application state management
│   │   └── yamlParser.ts          # YAML parsing and formula entry building
│   │
│   ├── infra/                     # Infrastructure utilities
│   │   ├── resourceMonitor.ts     # CPU/RAM monitoring for runtime status
│   │   └── watchers.ts            # File watchers and analysis scheduling
│   │
│   ├── providers/                 # VS Code language providers
│   │   ├── codeLensProvider.ts    # CodeLens for displaying C/C++ computed values
│   │   ├── definitionProvider.ts # Go to Definition for symbols (YAML ↔ C/C++)
│   │   └── hoverProvider.ts       # Hover previews with expanded formulas and values
│   │
│   ├── types/                     # TypeScript type definitions
│   │   └── FormulaEntry.ts        # Type definitions for formula entries
│   │
│   ├── ui/                        # User interface components
│   │   └── statusBar.ts           # Status bar management (formula count, runtime status)
│   │
│   └── utils/                     # Utility functions
│       ├── braceDepth.ts          # Brace depth calculation for macro parsing
│       ├── editor.ts              # Editor utilities (word picking, cursor position)
│       ├── localize.ts            # Localization/internationalization support
│       ├── nformat.ts             # Number formatting utilities
│       ├── output.ts              # Output channel with colored logging
│       ├── regex.ts               # Regex utilities
│       └── text.ts                # Text manipulation utilities
│
├── resources/                     # Static resources and assets
├── l10n/                          # Localization files
├── test/                          # Test files and fixtures
│   ├── test.c                     # Sample C/C++ file with defines and consts
│   ├── formulas.yaml              # Sample YAML formulas file
│   └── ntc_10k_table.csv          # Sample CSV table for NTC thermistor lookup
│
├── package.json                   # Extension manifest and npm dependencies
├── tsconfig.json                  # TypeScript configuration
├── esbuild.js                     # Build script (esbuild bundler)
├── README.md                      # Project documentation
├── CHANGELOG.md                   # Version history
└── LICENSE.md                     # MIT license
```

Note:
The node_modules directory contains all `npm` dependencies required to build and run the extension and is automatically generated by `npm install`.

---

## 🚀 Features

- C/C++ source files always remain under your control; the extension only flags potential misalignments.
- Hover on formula symbols in YAML files.
- Optional fallback hover/definition providers for C/C++ (`calcdocs.enableCppProviders`).
- Go to definition for:
  - keys defined in `formula*.yaml` / `formulas*.yml`
  - `#define` and `const` symbols found in C/C++ files
  - Multiple locations shown when symbols have conditional definitions
- Formula expansion with known symbol values.
- Numeric evaluation when expressions can be fully resolved.
- Recursive resolution of complex C/C++ definitions (`#define` and `const` with dependencies).
- C/C++ CodeLens for composite definitions with computed numeric values.
- Ambiguity warnings in CodeLens when definitions depend on preprocessor conditions.
- Mismatch detection between C/C++ constants and YAML computed values (warning lens when difference is significant).
- YAML write-back of `dati` and `value` fields on refresh.
- CSV/table lookups in formulas with named columns and optional interpolation.
- Status bar quick refresh and periodic background analysis.
- Runtime CPU/RAM monitor with a quick ON/OFF toggle from status bar.
- C/C++ function-like macro support with parameter expansion (e.g., `#define MY_MACRO(x) ((x) * 2)`).
- Configurable thousands separator for formatted numbers.
- Preprocessor conditional tracking (`#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`).
- Ambiguity detection for symbols with multiple conditional definitions.
- Stack safety with circular dependency detection and depth limit protection.

---

## ⌨️ Commands

| Command | What it does |
| --- | --- |
| `CalcDocs: Force Formula Refresh` | Rebuilds index, recalculates formulas, and writes back YAML (`dati`, `value`) |
| `CalcDocs: Set Scan Interval` | Sets periodic scan interval in seconds (`0` disables periodic scan/watchers) |
| `CalcDocs: Show Log Output` | Show console CalcDocs output |
| `CalcDocs: Toggle Enable/Disable extension` | Enables/disables CalcDocs at runtime without uninstalling it |
| Status bar button `CalcDocs` | Manual formula refresh |

---

## ⚙️ Configuration

Available workspace settings:

- `calcdocs.scanInterval` (number, default `0`)
- `calcdocs.ignoredDirs` (string array, folders excluded from analysis)
- `calcdocs.enableCppProviders` (boolean, default `true`, keeps C/C++ tools as primary)
- `calcdocs.enabled` (boolean, default `true`, global ON/OFF switch for CalcDocs)
- `calcdocs.resourceStatusMode` (`always` or `aboveCpuThreshold`, controls runtime status bar visibility)
- `calcdocs.resourceCpuThreshold` (number 0-100, default `70`, used when mode is `aboveCpuThreshold`)
- `calcdocs.thousandsSeparator` (`none`, `space`, `dot`, `comma`, `apostrophe`, `narrowNoBreakSpace`, default `space`)

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

## 📊 CSV Table Lookup

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

## 🧠 Complex Formulas and Constants

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
- Function-like `#define` with one-line expression:
  - `#define NAME(P1, P2, ...) EXPR`
  - calls like `NAME(123, A+1)` are expanded when arguments are resolvable
- `const`/`static const` scalar declarations with these types:
  - `long`, `int`, `short`, `char`, `float`, `double`
  - `int*_t`, `uint*_t` forms (e.g. `int32_t`, `uint16_t`)
  - optional `unsigned` prefix

Current limits:

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

---

## ⭐ Recommended Extensions

For the best experience when working with embedded C and C++, we recommend installing the following extensions:
- **C/C++ (Microsoft)** – *ms-vscode.cpptools*  
  Provides IntelliSense, code navigation, diagnostics, and high‑quality C/C++ editing support.
  Works perfectly alongside this extension for embedded workflows.

- **CMake Tools** – *ms-vscode.cmake-tools*  
  If your firmware or embedded project uses CMake, this extension offers automatic configuration, build presets, debugging integration, and seamless toolchain detection.

- **Cortex‑Debug** – *marus25.cortex-debug*  
  Recommended if you work with ARM MCUs.
  Supports SWD/JTAG debugging, RTT, semihosting, and GDB server integrations (OpenOCD, PyOCD, ST‑Link, J‑Link).

- **C/C++ DevTools** – *ms-vscode.cpp-devtools*  
  Brings additional capabilities built on top of the C/C++ extension, improving configuration, diagnostics and developer workflows for C/C++ projects.
  These extensions integrate naturally with this extension and are often used together in professional embedded environments.

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

## 📄 License

[![MIT License](./resources/mit-license.png)](./LICENSE.md)
