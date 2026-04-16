# 💡 Real Use Cases

---

## 1. Avoid Excel vs Firmware mismatch

### Problem
Formulas are calculated in Excel and manually copied into C code.

### Risks
- outdated values  
- wrong constants  
- silent bugs  

### Solution
CalcDocs evaluates values directly from C code.

👉 No duplication. No drift.

---

## 2. Understand legacy or external code

### Problem
Macros are defined across multiple files and layers.

### Pain
You must jump between files to understand a single value.

### Solution
Hover → see full expansion and final value.

👉 No navigation needed.

---

## 3. Debug faster

### Problem
Wrong values are discovered too late during debugging.

### Solution
CalcDocs shows computed values before runtime.

👉 Detect issues early.

---

## 4. Validate formulas against firmware

### Problem
Documentation formulas don’t match actual firmware logic.

### Solution
Link YAML formulas to real C constants.

👉 Guaranteed alignment.

---

## 5. Catch subtle bugs

CalcDocs helps detect:

- wrong parentheses  
- incorrect operator precedence  
- overflow issues  
- unit inconsistencies  

---

## 6. Git-friendly engineering workflow

YAML formulas:

- are versioned  
- are diffable  
- explain changes clearly  
- are plain text (no hidden cells, no implicit logic)
- integrate naturally with version control systems (Git, SVN, Mercurial)

👉 No hidden logic. No mystery calculations.  
👉 If it changes, you see it. If you see it, you version it.  
👉 Spreadsheets hide bugs. This doesn’t.
