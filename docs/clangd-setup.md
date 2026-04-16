# 🔧 Clangd Setup

CalcDocs uses **Clangd** as optional LSP backend for C/C++ symbol resolution and hovers.

---

## Why use Clangd with CalcDocs?

- **Higher accuracy** for complex projects
- **Standard tooling** integration (compile_commands.json)
- **Better performance** on large codebases
- Fallback to internal parser if unavailable

---

## Requirements

```
clangd executable in PATH
compile_commands.json (auto-generated)
VS Code clangd extension (optional)
```

---

## How to install (recommended)

### Windows Installation

1. Download LLVM from [releases](https://github.com/llvm/llvm-project/releases)
   - Choose `LLVM-*.win64.exe`
2. Install to `C:\Program Files\LLVM`
3. Add `C:\Program Files\LLVM\bin` to **system PATH**
4. Restart VS Code
5. Verify: `clangd --version` in terminal

---

### macOS Installation

**Homebrew (recommended):**
```
brew install llvm
```
Add to PATH in `~/.zshrc` or `~/.bash_profile`:
```
export PATH=\"/opt/homebrew/opt/llvm/bin:$PATH\"
```
Reload shell or `source ~/.zshrc`

**Verify:** `clangd --version`

---

### Linux Installation

**Ubuntu/Debian:**
```
sudo apt update
sudo apt install clangd
```

**Fedora:**
```
sudo dnf install clang-tools-extra
```

**LLVM release:**
Download from [llvm.org](https://releases.llvm.org/download.html)

**Verify:** `clangd --version`

---

## Generate compile_commands.json

**Required for optimal Clangd performance**

Open Command Palette (`Ctrl+Shift+P`):

```
CalcDocs: Generate compile_commands.json
```

🧠 Scans your project and creates an initial configuration for Clangd.

---

## Enable Clangd Integration

```json
{
  \"calcdocs.useClangd\": true
}
```

**Default**: `true` (auto-detects)

---

## Verify Setup

✅ Status bar shows **\"clangd active\"**

✅ Hover tooltips show **\"from clangd\"**

---

## 🚀 Hover Integration Behavior

Hover CalcDocs is a **\"silent enhancer only when clangd fails\"**, and when clangd is present it simply integrates the information that clangd doesn't provide.

**When clangd is active:**
- CalcDocs silently adds computed values (macros, YAML formulas/defines) that clangd does not provide
- No overlap or interference with clangd/intellisense
- Seamless complementary integration

**When clangd fails (fallback mode):**
- CalcDocs activates full enhanced hovers as primary enhancer
- Status bar shows `fallback mode`

---

## Status Indicators

| Status | Meaning | Action |
|--------|---------|--------|
| `clangd active` | ✅ Full integration | None |
| `clangd active (no compile_commands.json)` | ⚠️ Reduced accuracy | Generate compile_commands.json |
| `fallback mode` | Internal parser only | *Tips*: Install clangd |

---

## Troubleshooting

### `executable not found`
```
Add clangd to PATH
Restart VS Code
```

### Missing `compile_commands.json`
```
Run: CalcDocs: Generate compile_commands.json
Place in workspace root or build/
```

### Conflicts with vscode-clangd extension
```
Both can run simultaneously
CalcDocs uses its own clangd instance
```

---

## Advanced Usage

```
clangd --background-index
--compile-commands-dir=build/
--header-insertion=never
```

**CalcDocs auto-configures** optimal flags.

---

**CalcDocs works perfectly without Clangd** → just slower on massive projects.

