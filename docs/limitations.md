# ⚠️ Limitations

---

## C/C++ Parsing

- Multi-line macros are not fully supported
- Complex types (structs, pointers) are ignored
- Non-numeric expressions are not evaluated

---

## Evaluation

- Only finite numeric results are resolved
- Undefined symbols stop evaluation

---

## Preprocessor

- Some advanced macro patterns may not resolve correctly
- Deep conditional nesting may reduce accuracy

---

## Performance

- Very large projects may require tuning
- Deep dependency chains may trigger safety limits

---

## General

CalcDocs is designed for:

👉 numeric logic  
👉 constants  
👉 formulas  

Not for full C/C++ semantic analysis.