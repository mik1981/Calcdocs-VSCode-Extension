/**
 * Hover Provider per simboli C/C++ in VSCode.
 * 
 * Questo modulo gestisce la visualizzazione delle informazioni relative ai simboli
 * quando l'utente passa il mouse sopra di essi nel codice sorgente C/C++.
 * 
 * Il provider supporta:
 * - Valutazione di macro funzione (es. FINAL(VEL*MUL))
 * - Visualizzazione di formule definite in YAML
 * - Rilevamento di definizioni multiple (ambiguità)
 * - Definizioni condizionali del preprocessore (#ifdef, #ifndef)
 * 
 * @module providers/hoverProvider
 */

import * as vscode from "vscode";

import { parseCppSymbolDefinition } from "../core/cppParser";
import {
  buildCompositeExpressionPreview,
} from "../core/expression";
import { CalcDocsState } from "../core/state";
import { pickWord } from "../utils/editor";
import { formatNumbersWithThousandsSeparator, toHexString } from "../utils/nformat";
import { updateBraceDepth } from "../utils/braceDepth";
import { FUNCTION_DEFINE_RX, OBJECT_DEFINE_RX, DEFINE_NAME_RX }from "../utils/regex";
import { stripComments } from "../utils/text";
import { isNumber } from "util";

// =============================================================================
// COSTANTI DI CONFIGURAZIONE
// =============================================================================

/** Numero massimo di varianti condizionali da mostrare nella sezione hover */
const HOVER_VARIANT_LIMIT = 8;

/** Numero massimo di definizioni nello stesso documento da mostrare */
const HOVER_IN_DOC_DEFINITION_LIMIT = 6;

/** Regex per rilevare direttive #define */
const DEFINE_DIRECTIVE_RX = /^\s*#\s*define\b/;

// =============================================================================
// TIPI DI SUPPORTO
// =============================================================================

/**
 * Rappresenta una definizione di simbolo trovata nel documento.
 * 
 * @example
 * // Esempio di oggetto restituito:
 * {
 *   expr: "#define MAX_BUFFER 1024",
 *   line: 42
 * }
 */
type SymbolDefinitionInDocument = {
  /** Espressione completa della definizione (es. "#define FOO 42") */
  expr: string;
  /** Numero di linea (0-based) dove appare la definizione */
  line: number;
};

/**
 * Risultato dell'estrazione di una chiamata macro.
 * 
 * @example
 * // Input: "FINAL(VEL * MUL)" con cursore su FINAL
 * // Output: "FINAL(VEL * MUL)"
 */
type MacroCallExtraction = {
  /** La chiamata macro completa estratta (nome + argomenti) */
  call: string;
  /** Il nome della macro senza argomenti */
  name: string;
};

// =============================================================================
// SEZIONE 1: ESTRAZIONE MACRO
// =============================================================================

/**
 * Estrae una chiamata di macro funzione alla posizione del cursore.
 * 
 * Questa funzione analizza il testo intorno al cursore per determinare se
 * l'utente sta passando sopra una chiamata di macro funzione (es. `MACRO(arg1, arg2)`).
 * 
 * @param document - Il documento VSCode corrente
 * @param position - La posizione del cursore
 * @returns La chiamata macro completa (es. "FINAL(VEL*MUL)") o null se non trovata
 * 
 * @example
 * // Supponiamo che il cursore sia su "FINAL" in questa riga:
 * // result = FINAL(VEL * MUL)
 * // La funzione restituirà: "FINAL(VEL * MUL)"
 * 
 * @example
 * // Se il cursore è su un identificatore normale (non parte di una macro),
 * // la funzione restituirà: null
 */
function extractFunctionMacroCall(
  document: vscode.TextDocument,
  position: vscode.Position
): string | null {
  const line = document.lineAt(position.line).text;
  const lineUntilCursor = line.slice(0, position.character);

  // Trova l'inizio di un potenziale identificatore prima del cursore
  // Scorre a sinistra finché non trova un carattere non valido per un identificatore
  let start = lineUntilCursor.length - 1;
  while (start >= 0 && /[A-Za-z_]/.test(line[start])) {
    start -= 1;
  }
  start += 1;

  // Verifica che ci sia effettivamente un identificatore
  if (start >= lineUntilCursor.length) {
    return null;
  }

  const potentialName = line.slice(start, lineUntilCursor.length);
  
  // Verifica che il nome sia un identificatore C valido
  if (!/^[A-Za-z_]\w*$/.test(potentialName)) {
    return null;
  }

  // Verifica che ci sia una parentesi aperta dopo l'identificatore
  // (permette spazi bianchi tra nome e parentesi)
  const afterName = lineUntilCursor.slice(start + potentialName.length).match(/^\s*\(/);
  if (!afterName) {
    return null;
  }

  // Trova la parentesi di chiusura corrispondente
  // Tiene conto di parentesi annidate, parentesi quadre e stringhe
  let depth = 0;
  let end = start + potentialName.length + afterName[0].length - 1;

  while (end < line.length) {
    const char = line[end];

    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    } else if (char === '"' || char === "'") {
      // Gestione delle stringhe e caratteri (evita che ) dentro stringhe chiuda la macro
      const quote = char;
      end += 1;
      while (end < line.length) {
        if (line[end] === "\\") {
          // Salta i caratteri di escape
          end += 2;
          continue;
        }
        if (line[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      continue;
    }

    end += 1;
  }

  // Verifica che le parentesi siano bilanciate
  if (depth !== 0) {
    return null;
  }

  const expr = line.slice(start, end).trim();
  return expr || null;
}

/**
 * Prova a estrarre una chiamata macro usando un approccio regex di fallback.
 * 
 * Questo metodo viene usato quando extractFunctionMacroCall non trova nulla.
 * Utilizza una regex per trovare pattern del tipo IDENTIFICATORE(...).
 * 
 * @param fullLine - La riga completa di codice
 * @returns La chiamata macro trovata o null
 * 
 * @example
 * // Input: "#define RESULT (VALUE * 2)"
 * // Output: null (non è una chiamata, è una definizione)
 * 
 * @example
 * // Input: "x = FINAL(VALUE * MULT);"
 * // Output: "FINAL(VALUE * MULT)"
 */
function extractMacroCallWithRegex(fullLine: string): string | null {

  const match = fullLine.match(/([A-Za-z_]\w*)\s*\((.*)\)/);

  if (!match) {
    return null;
  }

  const call = match[0];

  // evita casi tipo "#define VALUE (A*B)"
  if (/^\s*#\s*define/.test(fullLine)) {
    return null;
  }

  return call;
}

/**
 * Cerca una chiamata macro nella parte destra di una direttiva #define.
 * 
 * @param defineLine - La riga #define completa
 * @returns La chiamata macro trovata o null
 * 
 * @example
 * // Input: "#define CALC(x) (x * MULT)"
 * // Output: null (la parte destra è un'espressione, non una chiamata)
 * 
 * @example
 * // Input: "#define COMPOSED FINAL(INNER(VALUE))"
 * // Output: "FINAL(INNER(VALUE))"
 */
function extractMacroCallFromDefineRightSide(line: string): string | null {

  // rimuove eventuali commenti //
  const noComment = line.split("//")[0];

  const defineMatch = noComment.match(/^\s*#\s*define\s+[A-Za-z_]\w*\s+(.*)$/);
  if (!defineMatch) {
    return null;
  }

  const rhs = defineMatch[1].trim();

  // trova nome macro
  const nameMatch = rhs.match(/^([A-Za-z_]\w*)\s*\(/);
  if (!nameMatch) {
    return null;
  }

  const macroName = nameMatch[1];
  let pos = nameMatch[0].length - 1; // posizione della "("

  let depth = 0;
  let end = pos;

  while (end < rhs.length) {

    const ch = rhs[end];

    if (ch === "(") {
      depth++;
    }
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
    else if (ch === '"' || ch === "'") {
      // salta stringhe
      const quote = ch;
      end++;
      while (end < rhs.length) {
        if (rhs[end] === "\\") {
          end += 2;
          continue;
        }
        if (rhs[end] === quote) {
          break;
        }
        end++;
      }
    }

    end++;
  }

  if (depth !== 0) {
    return null;
  }

  return rhs.slice(0, end).trim();
}

/**
 * Normalizza una chiamata macro per una visualizzazione più pulita.
 * 
 * Rimuove spazi superflui, standardizza parentesi e operatori.
 * 
 * @param call - La chiamata macro originale
 * @returns La chiamata normalizzata
 * 
 * @example
 * // Input: "FINAL( VEL * MUL )"
 * // Output: "FINAL(VEL*MUL)"
 * 
 * @example
 * // Input: "MAX( a , b )"
 * // Output: "MAX(a,b)"
 */
function normalizeMacroCallForDisplay(call: string): string {
  let s = call;
  
  // Rimuove spazi intorno alle parentesi
  s = s.replace(/\s+\(/g, "(");
  s = s.replace(/\(\s+/g, "(");
  s = s.replace(/\s+\)/g, ")");
  s = s.replace(/\)\s+/g, ")");
  
  // Rimuove spazi intorno alle virgole
  s = s.replace(/\s*,\s*/g, ",");
  
  // Rimuove spazi intorno agli operatori
  s = s.replace(/\s*([+\-*/%|&^<>])\s*/g, "$1");
  
  // Rimuove spazi multipli residui
  s = s.replace(/\s+/g, " ").trim();
  
  return s;
}

/**
 * Wraps a snippet in a C code block for syntax highlighting in hover.
 */
function toCCodeBlock(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    return "";
  }
  return `\`\`\`c\n${trimmed}\n\`\`\``;
}

function indentBlock(block: string, indent = "  "): string {
  return block
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

// =============================================================================
// SEZIONE 2: RICERCA DEFINIZIONI SIMBOLI
// =============================================================================

/**
 * Trova tutte le definizioni di un simbolo in un documento.
 * 
 * Questa funzione scorre tutte le righe del documento cercando definizioni
 * che corrispondono al nome del simbolo. Tiene conto della profondità delle
 * parentesi graffe per evitare di catturare dichiarazioni all'interno di
 * struct o blocchi.
 * 
 * @param document - Il documento VSCode dove cercare
 * @param word - Il nome del simbolo da cercare
 * @returns Array di oggetti contenenti l'espressione e la linea di ogni definizione
 * 
 * @example
 * // Contenuto del documento:
 * // 0: #define VALUE 10
 * // 1: #define VALUE 20
 * // 3: int x = VALUE;
 * // 
 * // Chiamata: findSymbolDefinitionsInDocument(doc, "VALUE")
 * // Output: [
 * //   { expr: "#define VALUE 10", line: 0 },
 * //   { expr: "#define VALUE 20", line: 1 }
 * // ]
 */
function findSymbolDefinitionsInDocument(
  document: vscode.TextDocument,
  word: string
): Array<SymbolDefinitionInDocument> {
  const lines = document.getText().split(/\r?\n/);
  const definitions: Array<SymbolDefinitionInDocument> = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    
    // Può parsare la dichiarazione solo se:
    // 1. Non siamo all'interno di un blocco ({})
    // 2. Oppure la riga è una direttiva #define (sempre parsabile)
    const canParseDeclaration = braceDepth === 0 || DEFINE_DIRECTIVE_RX.test(line);
    
    const parsed = canParseDeclaration ? parseCppSymbolDefinition(line) : undefined;
    
    // Se il parsed non corrisponde al simbolo cercato, aggiorna solo la profondità
    if (!parsed || parsed.name !== word) {
      braceDepth = updateBraceDepth(braceDepth, line);
      continue;
    }

    // Trovata una definizione del simbolo
    definitions.push({
      expr: parsed.expr,
      line: i,
    });

    braceDepth = updateBraceDepth(braceDepth, line);
  }

  return definitions;
}

// =============================================================================
// SEZIONE 3: FORMATTAZIONE SEZIONI HOVER
// =============================================================================

/**
 * Formatta la sezione delle definizioni condizionali multiple.
 * 
 * Quando un simbolo ha definizioni multiple dipendenti da condizioni del
 * preprocessore (#ifdef, #ifndef, #if), questa funzione crea una lista
 * markdown con tutte le varianti.
 * 
 * @param word - Il nome del simbolo
 * @param state - Lo stato dell'estensione contenente le definizioni condizionali
 * @returns Stringa markdown con la lista delle varianti, o null se non applicabile
 * 
 * @example
 // Stato: symbolConditionalDefs.get("DEBUG") = [
 //   { file: "main.c", line: 10, expr: "#define DEBUG 1", condition: "!defined(RELEASE)" },
 //   { file: "main.c", line: 20, expr: "#define DEBUG 0", condition: "defined(RELEASE)" }
 // ]
 // 
 // Output:
 // "**Multiple C/C++ definitions:**
 // - when `!defined(RELEASE)`: `#define DEBUG 1` (`main.c:11`)
 // - when `defined(RELEASE)`: `#define DEBUG 0` (`main.c:21`)"
 */
function formatConditionalDefinitionsSection(
  word: string,
  state: CalcDocsState
): string | null {
  const variants = state.symbolConditionalDefs.get(word);
  
  // Non mostrare se c'è 0 o 1 variante
  if (!variants || variants.length <= 1) {
    return null;
  }

  const lines: string[] = ["**Multiple C/C++ definitions:**"];
  const shown = variants.slice(0, HOVER_VARIANT_LIMIT);

  for (const variant of shown) {
    const location = `${variant.file}:${variant.line + 1}`;
    lines.push(`- when \`${variant.condition}\`:`);    
    const exprBlock = toCCodeBlock(variant.expr);
    if (exprBlock) {
      lines.push(indentBlock(exprBlock));
    } else {
      lines.push(`  \`${variant.expr}\``);
    }
    lines.push(`  (\`${location}\`)`);
  }

  // Aggiungi il conteggio delle varianti non mostrate
  if (variants.length > shown.length) {
    lines.push(`- ...and ${variants.length - shown.length} more`);
  }

  return lines.join("\n");
}

/**
 * Formatta la sezione delle definizioni multiple nello stesso documento.
 * 
 * Quando ci sono multiple definizioni dello stesso simbolo nel file corrente
 * (ma non tracciate come condizionali), mostra un elenco delle definizioni.
 * 
 * @param word - Il nome del simbolo
 * @param document - Il documento VSCode corrente
 * @param state - Lo stato dell'estensione
 * @param inDocumentDefinitions - Array delle definizioni trovate nel documento
 * @returns Stringa markdown o null
 * 
 * @example
 // Documento:
 // 5:  #define BUFFER_SIZE 256
 // 10: #define BUFFER_SIZE 512
 // 
 // Output:
 // "**Multiple definitions found in current file:**
 // - `#define BUFFER_SIZE 256` (`test.c:6`)
 // - `#define BUFFER_SIZE 512` (`test.c:11`)"
 */
function formatInDocumentMultipleDefinitionsSection(
  word: string,
  document: vscode.TextDocument,
  state: CalcDocsState,
  inDocumentDefinitions: Array<SymbolDefinitionInDocument>
): string | null {
  const trackedVariants = state.symbolConditionalDefs.get(word);
  
  // Non mostrare se ci sono già varianti condizionali tracciate
  if (trackedVariants && trackedVariants.length > 1) {
    return null;
  }

  // Non mostrare se c'è solo una definizione nel documento
  if (inDocumentDefinitions.length <= 1) {
    return null;
  }

  const lines: string[] = ["**Multiple definitions found in current file:**"];
  const shown = inDocumentDefinitions.slice(0, HOVER_IN_DOC_DEFINITION_LIMIT);
  const relativePath = vscode.workspace.asRelativePath(document.uri.fsPath);

  for (const definition of shown) {
    lines.push(
      `- \`${definition.expr}\` (\`${relativePath}:${definition.line + 1}\`)`
    );
  }

  if (inDocumentDefinitions.length > shown.length) {
    lines.push(`- ...and ${inDocumentDefinitions.length - shown.length} more`);
  }

  return lines.join("\n");
}

/**
 * Formatta la sezione dell'ambiguità eredata.
 * 
 * Quando un simbolo ha un valore che dipende da altri simboli ambigui,
 * questa funzione elenca questi simboli "genitori".
 * 
 * @param word - Il nome del simbolo
 * @param state - Lo stato dell'estensione
 * @returns Stringa markdown o null
 * 
 * @example
 // Stato: symbolAmbiguityRoots.get("RESULT") = ["VALUE", "MULTIPLIER"]
 // (significa che RESULT dipende da simboli con definizioni multiple)
 // 
 // Output:
 // "**Depends on symbols with multiple definitions:** `VALUE`, `MULTIPLIER`"
 */
function formatInheritedAmbiguitySection(
  word: string,
  state: CalcDocsState
): string | null {
  const roots = state.symbolAmbiguityRoots.get(word);
  if (!roots || roots.length === 0) {
    return null;
  }

  // Filtra fuori il simbolo stesso (per evitare auto-riferimenti)
  const inheritedFrom = roots.filter((name) => name !== word);
  if (inheritedFrom.length === 0) {
    return null;
  }

  return `**Depends on symbols with multiple definitions:** \`${inheritedFrom.join(
    "`, `"
  )}\``;
}

// =============================================================================
// SEZIONE 4: GESTIONE FORMULE
// =============================================================================

/**
 * Crea un link command per aprire la fonte della formula.
 * 
 * @param word - Il nome della formula
 * @param formula - L'oggetto formula contenente _filePath e _line
 * @returns Stringa markdown con il link, o null se mancano i dati
 * 
 * @example
 // Input:
 // word = "VOLTAGE_DIVIDER"
 // formula = { _filePath: "formulas.yaml", _line: 42, formula: "R1/(R1+R2)*Vin" }
 // 
 // Output:
 // "[Open formula source (formulas.yaml:43)](command:calcdocs.fixMismatch?%5B%22VOLTAGE_DIVIDER%22%5D)"
 */
function buildOpenFormulaCommandLink(
  word: string,
  formula: { _filePath?: string; _line?: number }
): string | null {
  if (!formula._filePath) {
    return null;
  }

  const line = (formula._line ?? 0) + 1;
  const locationLabel = `${formula._filePath}:${line}`;
  const args = encodeURIComponent(JSON.stringify([word]));
  return `[Open formula source (${locationLabel})](command:calcdocs.fixMismatch?${args})`;
}

/**
 * Formatta la sezione della formula YAML nel hover.
 * 
 * @param word - Il nome del simbolo
 * @param state - Lo stato dell'estensione
 * @param sections - Array delle sezioni da aggiornare
 * 
 * @example
 // Formula nel state.formulaIndex:
 // "RESISTOR_OHMS" -> {
 //   key: "RESISTOR_OHMS",
 //   unit: "Ω",
 //   formula: "R_REF * (1023/ADC - 1)",
 //   expanded: "1000 * (1023/512 - 1)",
 //   valueCalc: 998.0,
 //   steps: ["Calcolo: (1023/512)", "Moltiplicazione per R_REF"]
 // }
 // 
 // Sezioni generate:
 // "### RESISTOR_OHMS  \n*Unit:* `Ω`"
 // "*Steps:*\n  - `Calcolo: (1023/512)`\n  - `Moltiplicazione per R_REF`"
 // "*Formula:* **`R_REF * (1023/ADC - 1)`**"
 // "**`1000 * (1023/512 - 1)`** → `998`"
 */
function appendFormulaSection(
  word: string,
  state: CalcDocsState,
  sections: string[]
): void {
  const formula = state.formulaIndex.get(word);
  
  if (!formula) {
    return;
  }

  state.output.detail(`Formula found for ${word}`);
  
  // Inizia con il titolo della formula e l'unita opzionale
  sections.push(
    `### ${formula.key}${formula.unit ? `  \n*Unit:* \`${formula.unit}\`` : ""}`
  );

  // Aggiungi i passaggi di calcolo se presenti
  if (formula.steps && Array.isArray(formula.steps) && formula.steps.length > 0) {
    const stepLines = formula.steps.map((s) => `  - \`${s}\``).join("\n");
    sections.push(`*Steps:*\n${stepLines}`);
  }

  // Aggiungi la formula originale
  if (formula.formula) {
    sections.push("*Formula:*");
    const formulaBlock = toCCodeBlock(formula.formula);
    if (formulaBlock) {
      sections.push(formulaBlock);
    }
  }

  // Aggiungi l'espressione espansa e il valore calcolato
  if (formula.expanded) {
    sections.push("*Expanded:*");
    const expandedFormatted = formatNumbersWithThousandsSeparator(state, formula.expanded);
    const expandedBlock = toCCodeBlock(expandedFormatted);
    if (expandedBlock) {
      sections.push(expandedBlock);
    }

    if (typeof formula.valueCalc === "number") {
      // Formatta il valore decimale
      const decimalStr = formatNumbersWithThousandsSeparator(state, `${formula.valueCalc}`);
      // Se e un intero positivo, mostra anche la versione esadecimale
      const hexValue = toHexString(formula.valueCalc);
      if (hexValue) {
        sections.push(`→ \`${decimalStr}\` (${hexValue})`);
      } else {
        sections.push(`→ \`${decimalStr}\``);
      }
    }
  }

  // Aggiungi il link per aprire la formula
  const openFormulaLink = buildOpenFormulaCommandLink(word, formula);
  if (openFormulaLink) {
    sections.push(openFormulaLink);
  }
}

/**
 * Aggiunge il valore numerico noto del simbolo alla sezione hover.
 * 
 * @param word - Il nome del simbolo
 * @param state - Lo stato dell'estensione
 * @param sections - Array delle sezioni da aggiornare
 * 
 * @example
 // stato.symbolValues.get("MAX_BUFFER") = 1024
 // 
 // Output aggiunto a sections:
 // "MAX_BUFFER = **1024**"
 */
function appendKnownValueSection(
  word: string,
  state: CalcDocsState,
  sections: string[]
): void {
  // Se non c'è una formula, cerca almeno il valore numerico noto
  if (!state.formulaIndex.has(word) && state.symbolValues.has(word)) {
    const knownValue = state.symbolValues.get(word);
    if (typeof knownValue === "number") {
      // Formatta il valore decimale
      const decimalStr = formatNumbersWithThousandsSeparator(state, `${knownValue}`);
      
      // Se è un intero positivo, mostra anche la versione esadecimale
      const hexValue = toHexString(knownValue);
      if (hexValue) {
        sections.push(`${word} = **${decimalStr}** (${hexValue})`);
      } else {
        sections.push(`${word} = **${decimalStr}**`);
      }
    }
  }
}

// =============================================================================
// SEZIONE 5: VALUTAZIONE MACRO
// =============================================================================

/**
 * Valuta una chiamata macro e genera il contenuto della sezione hover.
 * 
 * Questa funzione usa buildCompositeExpressionPreview per espandere e valutare
 * la macro, poi formatta il risultato per la visualizzazione.
 * 
 * @param macroCall - La chiamata macro da valutare (es. "FINAL(VEL*MUL)")
 * @param state - Lo stato dell'estensione
 * @returns Stringa markdown con il risultato della valutazione
 * 
 * @example
 // Input: macroCall = "FINAL(VEL * MUL)"
 // Stato: symbolValues = { VEL: 100, MUL: 5 }, allDefines = { FINAL: "x*2" }
 // 
 // Preview: { expanded: "100 * 5 * 2", value: 1000 }
 // 
 // Output:
 // "**FINAL(VEL*MUL)**
 // → **1000**"
 */
function evaluateMacroForHover(
  macroCall: string,
  state: CalcDocsState
): string {
  // Espande e valuta la macro
  const preview = buildCompositeExpressionPreview(
    macroCall,
    state.symbolValues,
    state.allDefines,
    state.functionDefines,
    {},
    state.defineConditions
  );

  state.output.detail(`Preview.expanded: ${preview.expanded}`);
  state.output.detail(`Preview.value: ${preview.value}`);

  // Normalizza la chiamata per visualizzazione (rimuovi prima i commenti)
  const displayCall = normalizeMacroCallForDisplay(stripComments(macroCall));
  const sections: string[] = [];
  const displayBlock = toCCodeBlock(displayCall);
  sections.push(displayBlock || displayCall);

  if (preview.value !== null) {
    // Caso migliore: mostra direttamente il valore calcolato
    // Se e un intero positivo, mostra anche la versione esadecimale
    const decimalStr = formatNumbersWithThousandsSeparator(state, `${preview.value}`);
    const hexValue = toHexString(preview.value);
    if (hexValue) {
      sections.push(`→ **${decimalStr}** (${hexValue})`);
    } else {
      sections.push(`→ **${decimalStr}**`);
    }
  } else {
    const expanded = (preview.expanded ?? "").trim();

    if (!expanded || expanded === macroCall) {
      sections.push(`→ \`${displayCall}\``);
    } else {
      const expanded_number = Number(expanded);
      if (isNaN(expanded_number)) {
        const expandedBlock = toCCodeBlock(expanded);
        if (expandedBlock) {
          sections.push(`→\n${expandedBlock}`);
        } else {
          sections.push(`→ **${expanded}**`);
        }
      } else {
        sections.push(`→ **${expanded}** (${toHexString(expanded_number)})`);
      }
    }
  }

  return sections.join("\n\n");
}

// =============================================================================
// SEZIONE 6: GESTIONE DEBUG
// =============================================================================

/**
 * Helper per loggare messaggi di debug (solo se abilitati).
 * 
 * @param state - Lo stato dell'estensione
 * @param message - Il messaggio da loggare
 */
function debugLog(state: CalcDocsState, message: string): void {
  state.output.detail(message);
}

// =============================================================================
// SEZIONE 7: PROVIDER PRINCIPALE
// =============================================================================

/**
 * Registra il provider hover per simboli C/C++.
 * 
 * Questa funzione crea e registra un HoverProvider che:
 * 1. Rileva simboli sotto il cursore
 * 2. Prova a estrarre chiamate macro
 * 3. Cerca definizioni nel documento e nel workspace
 * 4. Costruisce il contenuto hover con formule, valori eambiguità
 * 
 * @param context - Contesto dell'estensione VSCode
 * @param state - Stato condiviso dell'estensione (contiene formule, valori, definizioni)
 * @param enableCppProviders - Flag per abilitare/disabilitare il provider
 * 
 * @example
 // Il provider risponderà a hover su file .c e .cpp mostrando:
 // - Valori numerici dei simboli (es. "MAX_BUFFER = **1024**")
 // - Formule YAML associate (es. "### RESISTOR_OHMS")
 // - Definizioni multiple (es. "Multiple definitions found...")
 // - Chiamate macro valutate (es. "FINAL(VEL*MUL) → **1000**")
 */
export function registerCppHoverProvider(
  context: vscode.ExtensionContext,
  state: CalcDocsState,
  enableCppProviders: boolean
): void {
  // Esce subito se i provider C/C++ sono disabilitati
  if (!enableCppProviders) {
    return;
  }

  // Selettori per i file C/C++ (sia file system che untitled)
  const cppSelectors: vscode.DocumentSelector = [
    { language: "c", scheme: "file" },
    { language: "cpp", scheme: "file" },
    { language: "c", scheme: "untitled" },
    { language: "cpp", scheme: "untitled" },
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(cppSelectors, {
      provideHover(document, position) {
        // =====================================================================
        // PASSO 1: Controlla se l'estensione è abilitata
        // =====================================================================
        if (!state.enabled) {
          debugLog(state, "Hover ignored: state.disabled");
          return undefined;
        }

        // =====================================================================
        // PASSO 2: Estrai il simbolo sotto il cursore
        // =====================================================================
        const word = pickWord(document, position);
        if (!word) {
          debugLog(state, "No word found at position");
          return undefined;
        }
        debugLog(state, `Hover word detected: ${word}`);

        // Ottieni il range della parola per il hover
        const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
        if (!range) {
          debugLog(state, "No identifier range found");
          return undefined;
        }

        // =====================================================================
        // PASSO 3: Rileva se siamo su una riga #define
        // =====================================================================
        const fullLine = document.lineAt(position.line).text;
        const isDefineLine = DEFINE_DIRECTIVE_RX.test(fullLine);

        debugLog(state, `Full line: ${fullLine}`);
        debugLog(state, `Is define line: ${isDefineLine}`);

        // =====================================================================
        // PASSO 4: Prova ad estrarre chiamata macro dalla posizione del cursore
        // =====================================================================
        let functionMacroCall = extractFunctionMacroCall(document, position);
        debugLog(state, `Function macro detected: ${functionMacroCall}`);

        // =====================================================================
        // PASSO 5: Fallback con regex (funziona anche su righe #define)
        // =====================================================================
        const fallbackCall = extractMacroCallWithRegex(fullLine);
        debugLog(state, `Fallback macro match: ${fallbackCall ?? "null"}`);

        // =====================================================================
        // PASSO 6: Macro individuata - usa la prima trovata, altrimenti fallback
        // =====================================================================
        let macroToEvaluate: string | null = functionMacroCall ?? fallbackCall ?? null;

        const defineMatch = fullLine.match(DEFINE_NAME_RX);
        const definedMacro = defineMatch?.[1] ?? null;

        // =====================================================================
        // PASSO 7: Gestione speciale delle righe #define
        // =====================================================================
        if (isDefineLine) {

          const functionDefineMatch = fullLine.match(FUNCTION_DEFINE_RX);
          const objectDefineMatch = fullLine.match(OBJECT_DEFINE_RX);

          // #define MACRO(...)
          if (functionDefineMatch) {

            const macroName = functionDefineMatch[1];

            // valuta solo se il cursore è sul nome
            if (word === macroName) {

              debugLog(state, "Function-like macro definition detected");

              const call = extractMacroCallFromDefineRightSide(fullLine);

              if (call) {
                macroToEvaluate = call;
              }

            } else {
              macroToEvaluate = null;
            }

          }
          // #define VALUE ...
          else if (objectDefineMatch) {

            // se il cursore è sulla macro definita → NON valutare
            if (word === definedMacro) {

              debugLog(
                state,
                "Hover on object-like macro name → skipping macro evaluation"
              );

              macroToEvaluate = null;
            }

            // se il cursore è su una macro nel RHS → prova a valutarla
            else {

              const rhsCall = extractMacroCallFromDefineRightSide(fullLine);

              if (rhsCall) {

                const rhsName = rhsCall.match(/^([A-Za-z_]\w*)/)?.[1];

                if (rhsName === word) {

                  debugLog(
                    state,
                    "Function-like macro detected in RHS of #define"
                  );

                  macroToEvaluate = rhsCall;
                } else {
                  macroToEvaluate = null;
                }

              } else {
                macroToEvaluate = null;
              }
            }
          }
        }
        // caso: #define NAME ...
        else {

          // se il cursore è sulla macro definita → non valutare
          if (word === definedMacro) {

            debugLog(
              state,
              "Hover on object-like macro name → skipping macro evaluation"
            );

            macroToEvaluate = null;

          } else {

            // se il cursore è su una macro nel RHS → valutala
            const rhsCall = extractMacroCallFromDefineRightSide(fullLine);

            if (rhsCall) {

              const rhsName = rhsCall.match(/^([A-Za-z_]\w*)/)?.[1];

              if (rhsName === word) {

                debugLog(
                  state,
                  "Function-like macro detected in RHS of #define"
                );

                macroToEvaluate = rhsCall;
              }
            }
          }
        }

        // =====================================================================
        // PASSO 8: Verifica che il cursore sia sul nome della macro
        // (Non su un argomento!)
        // =====================================================================
        
        // =====================================================================
        // PASSO 9: Se abbiamo una macro valida, valutala e mostra il risultato
        // =====================================================================
        if (macroToEvaluate) {
          debugLog(state, `Evaluating macro call: ${macroToEvaluate}`);

          const hoverContent = evaluateMacroForHover(macroToEvaluate, state);
          
          const markdown = new vscode.MarkdownString(hoverContent);
          markdown.isTrusted = true;

          debugLog(state, "Returning hover from macro evaluation.");
          return new vscode.Hover(markdown, range);
        }

        // =====================================================================
        // PASSO 10: LOGICA A LIVELLO SIMBOLO
        // Cerca definizioni nel documento corrente
        // =====================================================================
        const inDocumentDefinitions = findSymbolDefinitionsInDocument(document, word);
        debugLog(state, `In-document definitions found: ${inDocumentDefinitions.length}`);

        // =====================================================================
        // PASSO 11: Raccogli informazioni sullo stato del simbolo
        // =====================================================================
        const sections: string[] = [];
        const trackedVariants = state.symbolConditionalDefs.get(word) ?? [];
        const ambiguityRoots = state.symbolAmbiguityRoots.get(word) ?? [];

        debugLog(state, `Tracked variants: ${trackedVariants.length}`);
        debugLog(state, `Ambiguity roots: ${ambiguityRoots.length}`);

        // =====================================================================
        // PASSO 12: Determina il tipo di ambiguità
        // =====================================================================
        const hasTrackedAmbiguity = ambiguityRoots.length > 0;
        const hasInDocumentAmbiguity =
          trackedVariants.length <= 1 && inDocumentDefinitions.length > 1;

        if (hasTrackedAmbiguity) {
          sections.push(`**${word}: conditional value (multiple possible definitions)**`);
        } else if (hasInDocumentAmbiguity) {
          sections.push(`**${word}: multiple definitions found, value is not unique**`);
        }

        // =====================================================================
        // PASSO 13: Aggiungi le sezioni informative
        // =====================================================================
        
        // Sezione: definizioni condizionali multiple
        const conditionalDefinitions = formatConditionalDefinitionsSection(word, state);
        if (conditionalDefinitions) {
          sections.push(
            formatNumbersWithThousandsSeparator(state, conditionalDefinitions)
          );
        }

        // Sezione: definizioni multiple nello stesso documento
        const inDocumentAmbiguitySection = formatInDocumentMultipleDefinitionsSection(
          word,
          document,
          state,
          inDocumentDefinitions
        );
        if (inDocumentAmbiguitySection) {
          sections.push(inDocumentAmbiguitySection);
        }

        // Sezione: ambiguità ereditata da altri simboli
        const inheritedAmbiguity = formatInheritedAmbiguitySection(word, state);
        if (inheritedAmbiguity) {
          sections.push(inheritedAmbiguity);
        }

        // =====================================================================
        // PASSO 14: Aggiungi sezione formula (se presente)
        // =====================================================================
        appendFormulaSection(word, state, sections);

        // =====================================================================
        // PASSO 15: Aggiungi valore numerico noto (se nessuna formula)
        // =====================================================================
        appendKnownValueSection(word, state, sections);

        // =====================================================================
        // PASSO 16: Restituisci il risultato
        // =====================================================================
        if (sections.length === 0) {
          debugLog(state, "No hover sections generated → returning undefined");
          return undefined;
        }

        debugLog(state, `Generated hover sections:\n${sections.join("\n---\n")}`);

        const markdown = new vscode.MarkdownString(sections.join("\n\n"));
        markdown.isTrusted = true;

        return new vscode.Hover(markdown, range);
      },
    })
  );
}

