# ⚙️ Configuration

CalcDocs can be configured via VS Code settings.

---

## Core Settings

- `calcdocs.enabled`  
  Enable/disable extension

- `calcdocs.scanInterval`  
  Periodic scan interval (seconds)

- `calcdocs.ignoredDirs`  
  Folders excluded from analysis

---

## C/C++ Integration

- `calcdocs.enableCppProviders`  
  Enable fallback providers

- `calcdocs.cppDefines`  
  Extra preprocessor defines

- `calcdocs.cppUndefines`  
  Remove specific defines

- `calcdocs.cppConfiguration`  
  Select C/C++ config

---

## Inline Calc

- `calcdocs.inlineCalc.enableCodeLens`
- `calcdocs.inlineCalc.enableHover`
- `calcdocs.inlineCalc.diagnosticsLevel`

---

## Formatting

- `calcdocs.thousandsSeparator`

Options:
- none
- space
- dot
- comma
- apostrophe

---

## Performance

- `calcdocs.resourceStatusMode`
- `calcdocs.resourceCpuThreshold`

---

## Debug

- `calcdocs.internalDebugMode`

Levels:
- error
- warn
- info
- debug
- detail
- silent