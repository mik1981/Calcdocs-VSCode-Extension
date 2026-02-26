# 🧮 CalcDocs - Formula Hover, Definition and C/C++ Sync

Formula navigation and evaluation for YAML engineering formulas and C/C++ constants directly inside Visual Studio Code.

![CalcDocs Demo](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Refresh.gif)
![CalcDocs Screenshot](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Definition.jpg)

CalcDocs helps firmware, embedded, and software teams keep formulas, documentation, and source constants aligned.

- GitHub project: [Calcdocs-VSCode-Extension](https://github.com/mik1981/Calcdocs-VSCode-Extension/)
- Issues: [Open an issue](https://github.com/mik1981/Calcdocs-VSCode-Extension/issues)

## 📑 Index

- [Install from `.vsix` File (Quick Guide)](#install-from-vsix-file-quick-guide)
- [Features](#features)
- [Commands](#commands)
- [Configuration](#configuration)
- [File Scanning Rules](#file-scanning-rules)
- [Quick Example](#quick-example)
- [Contributing](#contributing)
- [Sponsor](#sponsor)
- [Roadmap](#roadmap)
- [License](#license)

---

## 📦 Install from `.vsix` File (Quick Guide)

If you already have the file `calcdocs-vscode-extension-0.1.3.vsix`, you can install it without using the Marketplace.

**Graphical method (recommended):**

1. Open **Visual Studio Code**.
2. Go to the **Extensions** view (left sidebar icon or press `Ctrl+Shift+X`).
3. Click the three dots `...` at the top of the Extensions panel.
4. Select **Install from VSIX...**.
5. Choose the `.vsix` file and confirm.
6. Restart VS Code.

**Terminal method (optional):**

```bash
code --install-extension calcdocs-vscode-extension-0.1.3.vsix
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
- `calcdocs.enableCppProviders` (boolean, default `false`, keeps C/C++ tools as primary)

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

[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.me/gianmichelepasinelli)

---

## 🗺️ Roadmap

Planned improvements:

- YAML schema validation
- stronger expression parsing
- more automated tests for YAML write-back
- configurable include/exclude paths

---

## 📄 License

[![MIT License](https://img.shields.io/github/license/Ileriayo/markdown-badges?style=for-the-badge)](./LICENSE.md)
