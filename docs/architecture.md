# 🧠 Architecture Overview

CalcDocs is structured in modular layers.

---

## Core Components

### Analysis Engine
- Scans workspace
- Builds symbol graph
- Coordinates evaluation

### Expression Engine
- Parses formulas
- Resolves dependencies
- Computes numeric results

### C/C++ Parser
- Extracts #define and const
- Handles macro expansion
- Tracks conditional compilation

### YAML Parser
- Reads formula definitions
- Links symbols to C code

---

## Providers

- Hover Provider
- CodeLens Provider
- Definition Provider

---

## Infrastructure

- File watchers
- Resource monitoring
- State management

---

## Data Flow

1. Scan files  
2. Build symbol table  
3. Resolve dependencies  
4. Evaluate expressions  
5. Provide UI feedback  

---

## Design Goal

👉 Provide **real-time understanding of computed values**  
without requiring compilation or debugging.