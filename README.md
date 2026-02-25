# CalcDocs — Formula Hover & Go to Definition

Formula navigation and evaluation for YAML engineering formulas and C/C++ constants inside Visual Studio Code.

![CalcDocs Demo](https://raw.githubusercontent.com/mik1981/convergo.calcdocs/main/resources/CalcDocs_Refresh.gif)

![CalcDocs Demo](https://raw.githubusercontent.com/mik1981/convergo.calcdocs/main/resources/CalcDocs_Definition.gif)

CalcDocs helps firmware, embedded, and software teams keep **technical formulas, documentation, and source code aligned** directly inside the editor.

---

## ✨ Features

- Hover over formula symbols in **YAML, C, and C++** files
- **Go to Definition** for:
  - formula keys defined in `formulas*.yaml` / `formulas*.yml`
  - numeric `#define` and `const` symbols in C/C++
- Formula expansion using known values
- Automatic refresh of YAML formulas
- Numeric evaluation when a formula can be fully resolved
- Automatic update of YAML fields (`dati` and `value`)
- Periodic background analysis of the workspace
- Quick refresh command available in the status bar

---

## ⚡ Quick Example

Example YAML formula file:

```yaml
MAX_SPEED:
  formula: RPM * WHEEL_RADIUS * 0.10472
  unit: m/s
  steps:
    - Read RPM from sensor
    - Convert RPM to rad/s
  value: 12.5

RPM:
  value: 1000

WHEEL_RADIUS:
  value: 0.2
```
When hovering on MAX_SPEED or RPM, CalcDocs provides:
- expanded formula
- current values
- navigation to symbol definition

---

## 🧠 Commands

### Command	Description
CalcDocs: Force formula refresh	Rebuilds the formula index and updates YAML values
CalcDocs: Set scan interval	Configures periodic background analysis
Status bar refresh	Quick manual refresh of formulas

---

## 📂 File Scanning Rules

Supported formula files:
- formula*.yaml
- formulas*.yml

Supported code files:
- .c
- .h
- .cpp
- .hpp

Customizable ignored folders
Extension activation occurs when opening a YAML file in the workspace.

---

## 🚀 Why CalcDocs

CalcDocs is useful when engineering formulas, documentation, and source code constants must stay synchronized.

It helps teams:
- reduce context switching
- quickly understand formulas
- navigate between documentation and code
- debug engineering calculations faster

---

## 🔎 Keywords

- vscode
- yaml formulas
- engineering formulas
- embedded development
- c/cpp constants
- formula evaluation
- hover documentation
- go to definition

---

## 🤝 Contributing

Contributions are welcome, especially for:

parser improvements

- diagnostics
- testing
- developer experience

---

## ❤️ Sponsor

If you find this extension useful, consider sponsoring the project to support its development.

[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.me/gianmichelepasinelli)

---

## 📌 Roadmap

Planned improvements:
- YAML schema validation
- more robust expression parsing
- automated tests for YAML write-back
- configurable include/exclude paths
- improved multi-root workspace support

---

## 📄 License

[![MIT License](https://img.shields.io/github/license/Ileriayo/markdown-badges?style=for-the-badge)](./LICENSE.md)
