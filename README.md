# 🧮 CalcDocs — See What Your Firmware Really Computes

[https://raw.githubusercontent.com/mik1981/Calcdocs-VSCode-Extension/main/badges/marketplace-version.png]
(https://marketplace.visualstudio.com/items?itemName=convergo-dev.calcdocs-vscode-extension)

[https://raw.githubusercontent.com/mik1981/Calcdocs-VSCode-Extension/main/badges/marketplace-downloads.png]
(https://marketplace.visualstudio.com/items?itemName=convergo-dev.calcdocs-vscode-extension)

[https://raw.githubusercontent.com/mik1981/Calcdocs-VSCode-Extension/main/badges/marketplace-rating.png]
(https://marketplace.visualstudio.com/items?itemName=convergo-dev.calcdocs-vscode-extension)

[https://raw.githubusercontent.com/mik1981/Calcdocs-VSCode-Extension/main/badges/license-mit.png]
(LICENSE.md)

**Stop guessing what your macros and formulas evaluate to.  
See real computed values from your C/C++ firmware — instantly, inside VS Code.**

CalcDocs shows you the *actual numeric results* of your C/C++ constants and YAML formulas — before you compile.

---

## ⚡ What problem does it solve?

In embedded projects, errors often hide in plain sight:

- A macro expands to something unexpected  
- A constant silently overflows  
- A formula looks correct but produces wrong values  
- YAML documentation drifts away from real firmware values  

👉 These issues are usually discovered **too late (after flashing)**.

**CalcDocs shows you the truth immediately.**  
It is a firmware understanding layer

![CalcDocs CodeLens Demo](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Refresh.gif)  
![CalcDocs Screenshot](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Definition.jpg)  
![CalcDocs Formula Refresh Demo](https://github.com/mik1981/Calcdocs-VSCode-Extension/raw/main/resources/CalcDocs_Formulas.gif)  

---

## 👀 What you actually see

Write this:

```c
#define RPM 1000
#define SPEED (RPM * 0.10472)
```

Hover SPEED →

```text
RPM * 0.10472
= 1000 * 0.10472
= 104.72 (0x68.B8)
```

💡 No compile. No debug. No guessing.

--- 

# 🔧 Quick Start (1 minute)
1. Install the extension
2. Open a C/C++ or YAML file
3. Hover any:
   - #define
   - const
   - YAML formula symbol

✅ Done — values appear automatically

--- 

# 💡 Why it's useful (real cases)
🔥 Detect overflow before it breaks your MCU  
🔍 **Understand complex macro chains instantly**  
🔄 Keep YAML formulas and C constants aligned  
⚠️ Catch mismatches between documentation and firmware  

--- 

# ⭐ Key Features
- Real computed values (compiler-like evaluation)
- Hover previews with full expansion (dec + hex)
- Go to definition (YAML ↔ C/C++)
- CodeLens with resolved values
- Mismatch detection (YAML vs C)
- Inline calculations in comments (// calc:)
- Conditional macro support (#ifdef, #if, etc.)

--- 

# 🧪 Example (YAML + C sync)
```yaml
MAX_SPEED:
  formula: RPM * 0.10472
#define RPM 1000
const float MAX_SPEED = RPM * 0.10472;
```

👉 CalcDocs verifies they produce the same value.

# 🧠 Who is this for?
- Embedded developers
- Firmware engineers
- Control / mechanical engineers working with formulas
- Anyone dealing with C macros + numeric logic

--- 

# ⚙️ Recommended setup

Works best with:

- C/C++ (ms-vscode.cpptools)
- CMake Tools
- Cortex-Debug

--- 

## ❤️ Support

If CalcDocs helps you save time or avoid bugs, consider supporting the project:

- ⭐ **Leave a review** (this helps a lot)  
  https://marketplace.visualstudio.com/items?itemName=convergo-dev.calcdocs-vscode-extension

- 💖 **Sponsor development**  
  [![PayPal](https://img.shields.io/badge/PayPal-Support-blue?logo=paypal&logoColor=white)](https://www.paypal.me/gianmichelepasinelli)

--- 

## 📚 Documentation

Full documentation available on GitHub:

- 👉 [Getting Started](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/getting-started.md)
- 👉 [Real Use Cases](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/use-cases.md)
- 👉 [Features Overview](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/features.md)
- 👉 [Configuration](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/configuration.md)
- 👉 [Architecture](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/architecture.md)
- 👉 [Limitations](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/limitations.md)
- 👉 [Contributing](https://github.com/mik1981/Calcdocs-VSCode-Extension/blob/main/docs/contributing.md)