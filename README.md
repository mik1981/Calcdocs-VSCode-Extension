# 🧮 CalcDocs — Instantly See What Your Firmware REALLY Computes **[0.2.5-prerelease]**

[![Version](https://vsmarketplacebadges.dev/version-short/convergo-dev.calcdocs-vscode-extension.svg)](https://visualstudio.com)
[![Download](https://vsmarketplacebadges.dev/downloads-short/convergo-dev.calcdocs-vscode-extension.svg)](https://visualstudio.com)
[![License](./resources/license-badge.png)](./LICENSE.md)

Stop expanding macros.
Stop guessing values.

👉 Hover any C/C++ constant → see the **final computed value instantly**

No build. No debug. No navigation.

---

## ⚡ 5-second demo

Write this:

```c
#define RPM 1000
#define SPEED (RPM * 0.10472)
```

You instantly see:

```c
#define SPEED (RPM * 0.10472)   ← 104.72
```

✅ No compile  
✅ No debugger  
✅ No manual calculation  

👉 What you see = what your firmware computes

## ⚡ 5-second demo - Macro Chain Revelation

| File | Screenshot |
| :---: | :---: |
| Inside ***C code*** | ![Macro Chain Revelation in code](./resources/macro_chain_revelation_code.gif) |
| Inside ***formulas\*.yaml*** file | ![Macro Chain Revelation in formulas](./resources/macro_chain_revelation_formulas.gif) |

## Firmware blindness before & after

|  |  |
| :---: | :---: |
| **Before** | ![Before](./resources/firmware_blindness_before.png) |
| **After** | ![After](./resources/firmware_blindness_after.png) |

## Macro and constant generation header output by quick menu

| Header file generation | 
| :---: |
![Macro and constant generation header output](./resources/generate_header.gif) |  

| Quick menu |
| :---: |
| ![Macro and constant generation header output](./resources/quick_menu.png) |

---

## 🔥 Why this matters

Firmware is not hard because of logic —
it's hard because **values are hidden**.

* Macros span multiple files
* Constants depend on chains
* Formulas live in Excel or docs
* Units and scaling are implicit

👉 Understanding one value = navigating half the project

**CalcDocs removes that friction completely.**

---

## 👀 What you get

### See real values instantly

* Inline previews for macros and constants
* Hover with resolved numeric values
* CodeLens summaries directly in code
* Decimal + hex representation

---

### 🔗 YAML ↔ C synchronization

* Define formulas in `formulas*.yaml`
* See results directly in C/C++
* No duplication, no drift

---

### ⚖️ Built-in validation

* Unit consistency checks
* Overflow detection
* Mismatch diagnostics (YAML vs C)

---

### ⚡ Works on real projects

* clangd integration (optional, high accuracy)
* IntelliSense-compatible (no conflicts)
* Internal parser fallback (always works)
* Optimized for large codebases

---

## 🧠 How it works (simple)

CalcDocs combines 3 things:

1. Reads your C/C++ code (macros, constants)
2. Evaluates expressions safely
3. Shows results inline in VS Code

Optional:

* Uses clangd for deeper analysis
* Syncs with YAML formulas

👉 No configuration required to start

---

## 📄 YAML Formula System

Define formulas once:

```yaml
power:
  formula: vin * current
  unit: W
```

Use them everywhere.

CalcDocs:

* evaluates them
* links them to C/C++
* shows results inline

👉 Your formulas become **live and synchronized**

---

## 👀 What it looks like in real code

```c
#define VIN 24
#define CURRENT 2
#define POWER (VIN * CURRENT)
```

CalcDocs shows:

```c
#define POWER (VIN * CURRENT)   ← 48W
```

---

## 🚀 0 → Value in seconds

1. Install the extension
2. Open a C/C++ file
3. Hover any value

✅ Done

---

## 💡 Real use cases

### 🔍 Understand code instantly

No more jumping across headers to resolve macros

### ⚠️ Catch bugs early

See wrong values before flashing your MCU

### 🔄 Eliminate Excel drift

Formulas stay aligned with firmware

### 🧪 Debug faster

Know values before runtime

---

## ❗ What CalcDocs is NOT

* Not a compiler
* Not a debugger
* Not a full static analyzer

👉 It focuses on one thing:

**making numeric logic visible**

---

## ⚙️ Recommended setup (optional)

Works best with:

* **clangd (recommended)** → better symbols & accuracy
* C/C++ (ms-vscode.cpptools)
* CMake Tools

CalcDocs integrates without conflicts.

---

## ⭐ Key capabilities (advanced)

* Full macro expansion (including chained expressions)
* Conditional macro awareness (`#if`, `#ifdef`, etc.)
* CSV/table lookups inside YAML formulas
* Header generation (`macro_generate.h`)
* Inline calculations inside comments
* LRU cache for large projects
* Hybrid symbol resolution (clangd + fallback parser)

--- 

## ❤️ Support

If CalcDocs saves you time:

- ⭐ **Leave a review** (this helps a lot)  
  https://marketplace.visualstudio.com/items?itemName=convergo-dev.calcdocs-vscode-extension

- 💖 Support development  
  [![PayPal](https://img.shields.io/badge/PayPal-Support-blue?logo=paypal&logoColor=white)](https://www.paypal.me/gianmichelepasinelli)

--- 

## 🚀 Roadmap

* Multi-workspace support
* Better visualization (graphs, relationships)
* Performance improvements for huge projects
* Export values to CSV/JSON
* Extended unit conversion
* Cortex-Debug integration
* AI-assisted validation

---

## 📚 Documentation

Full documentation available on GitHub:

- 👉 [Getting Started](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/getting-started.md)
- 👉 [Formula YAML Guide](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/formulas-yaml.md)
- 👉 [Real Use Cases](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/use-cases.md)
- 👉 [Features Overview](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/features.md)
- 👉 [Configuration](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/configuration.md)
- 👉 [Architecture](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/architecture.md)
- 👉 [Limitations](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/limitations.md)
- 👉 [Contributing](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/contributing.md)
- 👉 [Inline Calculations](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/inline-calculations.md)

---

## 🧠 Final thought

Spreadsheets hide logic.
Code hides values.

**CalcDocs reveals both.**
