/******************************************************************
 *  CalcDocs - Versione finale NO-LSP con CodeLens numeriche
 *
 *  Funzioni incluse:
 *  - Analisi YAML (formulas*.yaml)
 *  - Analisi C/C++ (#define, const)
 *  - Hover YAML
 *  - Hover C/C++ (fallback)
 *  - Definition YAML
 *  - Definition C/C++ (fallback)
 *  - Jump bidirezionale (goToCounterpart)
 *  - Write-back YAML
 *  - Watchers & periodic scan
 *  - CodeLens C/C++ con risultato numerico (modalità A)
 ******************************************************************/

import * as vscode from "vscode";
import * as fsp from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";

// -----------------------------------------
// STATO
// -----------------------------------------
type FormulaEntry = {
  key: string;
  unit?: string;
  formula?: string;
  dati?: string;
  steps: string[];
  valueYaml?: number;
  expanded?: string;
  valueCalc?: number | null;
  _filePath?: string;   // relativo alla root
  _line?: number;       // riga top-level nel YAML
};

const output = vscode.window.createOutputChannel("CalcDocs");
let statusBar: vscode.StatusBarItem | undefined;
let workspaceRoot = "";
let lastYamlPath = "";
let lastYamlRaw = "";
let allDefines = new Map<string, string>();   // memorizza tutte le define grezze per risoluzione ricorsiva

let analysisTimer: NodeJS.Timeout | null = null;
let ANALYSIS_INTERVAL_MS = 0;

let hasFormulasFile = false;  //  indica se è presente un file delle formule

const formulaIndex = new Map<string, FormulaEntry>();
const symbolValues = new Map<string, number>(); // valori note (YAML value + const/define)
const symbolDefs   = new Map<string, { file: string; line: number }>(); // dove è definito (C)

let IGNORED_DIRS = new Set<string>();

// -----------------------------------------
// CONFIG & UTILS
// -----------------------------------------
// Numero letterale (interi/float/hex/bin/oct) con eventuali suffissi C e parentesi esterne
const NUM_LITERAL_RX = /^\s*(?:[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)\s*(?:ul|lu|ull|llu|u|l|ll|f)?\s*$/;

function updateStatusBarVisibility() {
  if (statusBar) hasFormulasFile? statusBar.show() : statusBar.hide();
}

function unwrapParens(s: string): string {
  let t = s.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) break;
    t = inner;
  }
  return t;
}

function isPureNumeric(expr: string): boolean {
  const s = unwrapParens(stripComments(expr));
  return NUM_LITERAL_RX.test(s);
}

const OP_RX = /[+\-*/%&|^~<>?:()]/;

function isCompositeExpression(expr: string): boolean {
  const s = stripComments(expr).trim();
  if (!s) return false;
  if (isPureNumeric(s)) return false;               // niente CodeLens per numeri “nudi”
  if (OP_RX.test(s)) return true;                   // ha operatori → composita
  const toks = s.match(/[A-Za-z_]\w*/g) ?? [];      // dipende da simboli?
  return toks.some(t => symbolValues.has(t) || allDefines.has(t));
}

// Valuta un'espressione composta sostituendo prima i simboli noti, poi risolvendo ricorsivamente le define
function evaluateComposite(expr: string): number | null {
  try {
    let expanded = stripComments(expr);

    expanded = expanded.replace(/[A-Za-z_]\w*/g, (tok) => {
      if (symbolValues.has(tok)) return String(symbolValues.get(tok));
      const v = resolveSymbol(tok, allDefines, new Map<string, number>());
      return v != null ? String(v) : tok;
    });

    // se restano identificatori, non è completamente numerica → non forzare
    if (/[A-Za-z_]\w*/.test(expanded)) return null;

    return safeEval(expanded);
  } catch {
    return null;
  }
}

function getCfg() {
  const cfg = vscode.workspace.getConfiguration("calcdocs");
  return {
    scanInterval: Number(cfg.get<number>("scanInterval", 0)),
    ignoredDirs: cfg.get<string[]>("ignoredDirs", []),
    enableCppProviders: cfg.get<boolean>("enableCppProviders", false),
  };
}

function updateIgnoredDirs() {
  IGNORED_DIRS = new Set(getCfg().ignoredDirs);
}

function isIgnoredUri(uri: vscode.Uri): boolean {
  const p = uri.fsPath.replace(/\\/g, "/").toLowerCase();
  for (const raw of IGNORED_DIRS) {
    const e = raw.replace(/\\/g, "/").toLowerCase();
    if (e.endsWith("*")) {
      if (p.includes("/" + e.slice(0, -1))) return true;
    } else {
      if (p.includes("/" + e + "/") || p.endsWith("/" + e)) return true;
    }
  }
  return false;
}

// -----------------------------------------
// PARSING / MATH (copiato/riadattato da server.ts)
// -----------------------------------------
const TOKEN_RX = /[A-Za-z_][A-Za-z0-9_]*/g;
const DEFINE_RX = /^\s*#define\s+([A-Za-z_]\w*)\s+([^\r\n]+?)\s*$/;
const CONST_RX = /\b(?:static\s+)?const\s+(?:unsigned\s+)?(?:long|int|short|char|float|double|uint\d*_t|int\d*_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+)/g;
const SRC_EXTS = new Set([".c", ".h", ".cpp", ".hpp", ".cc", ".hh"]);

function stripComments(s: string) {
  const noLine = s.split("//")[0];
  return noLine.replace(/\/\*.*?\*\//g, "").trim();
}

function cleanLiteralSuffixes(expr: string): string {
  return expr.replace(/(?<=\d)(ul|lu|ull|llu|u|l|ll|f)\b/gi, "");
}

function safeEval(expr: string): number {
  const cleaned = cleanLiteralSuffixes(expr);
  // NB: usa solo su input post-sostituzione (no token sconosciuti)
  // In estensione locale (non web), questo eval è accettabile: non prende input remoto.
  const fn = new Function(`"use strict"; return (${cleaned});`);
  const val = fn();
  if (typeof val !== "number" || !Number.isFinite(val)) throw new Error("non-numeric");
  return val;
}

function replaceTokens(expr: string, values: Map<string, number>): string {
  if (!expr) return expr;
  return expr.replace(TOKEN_RX, (tok) => (values.has(tok) ? String(values.get(tok)) : tok));
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: vscode.FileStat[] | vscode.Uri[] | any;
    // Usa API Node per semplicità come nel server.ts
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name)) await walk(full);
        } else {
          out.push(full);
        }
    }
  }
  await walk(root);
  return out;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getYamlTopLevelLine(yamlText: string, key: string): number {
  const lines = yamlText.split(/\r?\n/);
  const rx = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(#.*)?$`);
  return lines.findIndex((l) => rx.test(l));
}

function clampLen(s: string, max = 5000) {
  return s.length > max ? s.slice(0, max) + " …" : s;
}

// ============================================================
// PARSING C/C++: #define / const
// ============================================================

async function collectDefinesAndConsts(files: string[], root: string) {
  const defines = new Map<string, string>();
  const consts = new Map<string, number>();
  const locations = new Map<string, { file: string; line: number }>();

  for (const file of files) {
    if (!SRC_EXTS.has(path.extname(file).toLowerCase())) continue;

    let text = "";
    try { text = await fsp.readFile(file, "utf8"); } 
    catch { continue; }

    const lines = text.split(/\r?\n/);
    // #define semplici (no macro con parametri)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(DEFINE_RX);
      if (m) {
        const name = m[1];
        const expr = stripComments(m[2]);
        if (!name.includes("(") && !defines.has(name)) {
          defines.set(name, expr);
          locations.set(name, { file: path.relative(root, file), line: i });
        }
      }
    }
    // const numeriche
    for (const match of text.matchAll(CONST_RX)) {
      const name = match[1];
      const expr = stripComments(match[2]);
      try {
        const val = safeEval(expr);
        if (!consts.has(name)) {
          consts.set(name, val);
          const line = lines.findIndex((l) => l.includes(name));
          locations.set(name, {
            file: path.relative(root, file),
            line: Math.max(0, line)
          });
        }
      } catch { /* ignore non-evaluable */ }
    }
  }

  return { defines, consts, locations };
}

function resolveSymbol(
  name: string,
  defines: Map<string, string>,
  resolved: Map<string, number>
): number | null {
  if (resolved.has(name)) return resolved.get(name)!;

  if (symbolValues.has(name)) {
    const v = symbolValues.get(name)!;
    resolved.set(name, v);
    return v;
  }
  
  if (!defines.has(name)) return null;

  const expr = defines.get(name)!;
  const tokens = expr.match(TOKEN_RX) ?? [];
  let expanded = expr;

  for (const t of tokens) {
    if (t === name) continue;
    const v = resolveSymbol(t, defines, resolved);
    if (v != null) expanded = expanded.replace(new RegExp(`\\b${t}\\b`, "g"), String(v));
  }

  try {
    const num = safeEval(expanded);
    resolved.set(name, num);
    symbolValues.set(name, num);
    return num;
  } catch {
    return null;
  }
}

function expandExpression(
  expr: string,
  defines: Map<string, string>,
  resolved: Map<string, number>
): string {
  let out = expr;
  const tokens = expr.match(TOKEN_RX) ?? [];
  for (const t of tokens) {
    const val = resolveSymbol(t, defines, resolved);
    if (val != null) out = out.replace(new RegExp(`\\b${t}\\b`, "g"), String(val));
  }
  return out;
}

// -----------------------------------------
// ANALISI (ex runAnalysis in server.ts)
// -----------------------------------------
async function runAnalysis(root: string) {
  try {
    updateIgnoredDirs();

    const files = await listFilesRecursive(root);

    // formulas*.yaml
    const ymlPath = files.find((f) => {
      const b = path.basename(f).toLowerCase();
      return (b.startsWith("formula") || b.startsWith("formulas")) &&
             (b.endsWith(".yaml") || b.endsWith(".yml"));
    });
 
    const prevHas = hasFormulasFile;
    hasFormulasFile = Boolean(ymlPath);
    if (prevHas !== hasFormulasFile) {
      updateStatusBarVisibility();
    }

    if (!ymlPath) {
      // Nessun YAML: continua comunque l’analisi C/C++
      if (files.length > 0) {
        const { defines, consts, locations } = await collectDefinesAndConsts(files, root);

        allDefines.clear();
        symbolValues.clear();
        symbolDefs.clear();

        // Valori da #define numerici
        for (const [name, expr] of defines) {
          try {
            const numeric = safeEval(expr);
            symbolValues.set(name, numeric);
            allDefines.set(name, expr);
          } catch {
            // define non numerico: lo teniamo comunque per expandExpression
            allDefines.set(name, expr);
          }
        }

        // Valori da const TYPE NAME = NNN;
        for (const [key, val] of consts) {
          symbolValues.set(key, val);
        }

        // Location delle define/const
        for (const [key, loc] of locations) {
          symbolDefs.set(key, loc);
        }

        // NON cancellare formulaIndex qui → permette mismatch detection minima
        output.appendLine(`[CalcDocs] Nessun formulas*.yaml, ma analisi C/C++ completata (${symbolValues.size} valori)`);

        updateStatusBar(); // anche se YAML non c’è, la barra non deve sparire
      }

      return;  // Esci, ma senza resettare tutto
    }
/*     if (!ymlPath) {
      formulaIndex.clear();
      symbolValues.clear();
      symbolDefs.clear();
      output.appendLine(`Nessun formulas*.yaml trovato in ${root}`);
      updateStatusBar();
      return;
    }
 */
    // Carica YAML
    let rawText = "";
    let yml: any;
    try {
      rawText = await fsp.readFile(ymlPath, "utf8");
      yml = yaml.load(rawText);
    } catch (e: any) {
      output.appendLine(`Errore YAML: ${e.message ?? e}`);
      return;
    }
    
    if (!yml || typeof yml !== "object" || Array.isArray(yml)) {
      output.appendLine("YAML radice non valido.");
      return;
    }

    lastYamlPath = ymlPath;
    lastYamlRaw  = rawText;

    // 1) valori top-level .value
    symbolValues.clear();
    
    for (const [k, v] of Object.entries<any>(yml)) {
      if (v && typeof v === "object" && "value" in v) {
        const n = Number(v.value);
        if (Number.isFinite(n)) symbolValues.set(k, n);
      }
    }

    // 2) define/const da sorgenti C/C++
    const { defines, consts, locations } = await collectDefinesAndConsts(files, root);
    allDefines.clear();
    for (const [name, expr] of defines) {
      try {
        const numeric = safeEval(expr);
        symbolValues.set(name, numeric);
        allDefines.set(name, expr)
      } catch { /* keep for expansion */ }
    }
    for (const [k, v] of consts) symbolValues.set(k, v);

    symbolDefs.clear();
    for (const [k, loc] of locations) symbolDefs.set(k, loc);

    // 3) indicizza formule
    formulaIndex.clear();
    for (const [key, node] of Object.entries<any>(yml)) {
      if (!node || typeof node !== "object") continue;

      const entry: FormulaEntry = {
        key,
        unit:    typeof node.unit === "string" ? node.unit : undefined,
        formula: typeof node.formula === "string" ? node.formula : undefined,
        dati:    typeof node.dati === "string" ? node.dati : undefined,
        steps:   Array.isArray(node.steps) ? node.steps.map(String) : [],
        valueYaml: Number.isFinite(Number(node.value)) ? Number(node.value) : undefined,
        expanded: undefined,
        valueCalc: null,
        _filePath: path.relative(root, ymlPath),
        _line: getYamlTopLevelLine(rawText, key)
      };

      // espansione formula
      if (entry.formula) {
        const resolvedMap = new Map<string, number>();
        let expanded = replaceTokens(entry.formula, symbolValues);
        expanded     = expandExpression(expanded, defines, resolvedMap);
        entry.expanded = clampLen(expanded);

        // calcolo numerico se possibile
        if (!/[A-Za-z_][A-Za-z0-9_]*/.test(expanded)) {
          try { entry.valueCalc = safeEval(expanded); }
          catch { /* entry.valueCalc = null; */ }
        }
      }

      formulaIndex.set(key, entry);
    }

    updateStatusBar();
    output.appendLine(`[${new Date().toLocaleTimeString()}] Analisi ok (${formulaIndex.size} formule)`);

  } catch (err: any) {
    output.appendLine("[Analysis error] " + (err?.message ?? err));
  }
}

// -----------------------------------------
// WRITE-BACK YAML (porting 1:1)
// -----------------------------------------
async function writeBackYaml(ymlPath: string, rawText: string) {
  const originalLines = rawText.split(/\r?\n/);
  const lines = [...originalLines];
  let changed = false;

  const RX_VALUE   = /^\s*value\s*:/i;
  const RX_DATI    = /^\s*dati\s*:/i;
  const RX_FORMULA = /^\s*formula\s*:/i;

  for (const [key, entry] of formulaIndex) {
    const lineIndex = entry._line ?? -1;
    if (lineIndex < 0 || lineIndex >= lines.length) continue;

    const keyLine = lines[lineIndex];
    const keyIndent  = (keyLine.match(/^\s*/) || [""])[0];
    const fieldIndent = keyIndent + "  ";

    let ptr = lineIndex + 1;
    let valueLineIndex = -1;
    let datiLineIndex = -1;

    while (ptr < lines.length) {
      const curr = lines[ptr];
      const trimmed = curr.trim();
      const isEmpty = trimmed.length === 0;
      const isIndented = /^\s+/.test(curr);
      if (!isEmpty && !isIndented) break;
      if (RX_VALUE.test(curr)) valueLineIndex = ptr;
      else if (RX_DATI.test(curr)) datiLineIndex = ptr;

      ptr++;
    }
    const blockStart = lineIndex + 1;
    const blockEnd = ptr;

    // DATI
    if (entry.expanded) {
      const newDati = `${fieldIndent}dati: ${entry.expanded}`;
      if (datiLineIndex >= 0) {
        if (lines[datiLineIndex] !== newDati) {
          lines[datiLineIndex] = newDati;
          changed = true;
        }
      } else {
        let formulaIdx = -1;
        for (let i = blockStart; i < blockEnd; i++) {
          if (RX_FORMULA.test(lines[i])) { formulaIdx = i; break; }
        }
        const insertAt = formulaIdx >= 0 ? formulaIdx : blockStart;
        lines.splice(insertAt, 0, newDati);
        changed = true;
        if (valueLineIndex >= 0 && valueLineIndex >= insertAt) valueLineIndex++;
      }
    }

    // VALUE
    if (entry.valueCalc != null) {
      const newValue = `${fieldIndent}value: ${entry.valueCalc}`;
      if (valueLineIndex < 0) {
        for (let i = blockStart; i < blockEnd; i++) {
          if (RX_VALUE.test(lines[i])) { valueLineIndex = i; break; }
        }
      }

      if (valueLineIndex >= 0) {
        if (lines[valueLineIndex] !== newValue) {
          lines[valueLineIndex] = newValue;
          changed = true;
        }
      } else {
        let insertAt = datiLineIndex >= 0 ? datiLineIndex + 1 : blockStart;
        lines.splice(insertAt, 0, newValue);
        changed = true;
      }
    }
  }

  const outText = lines.join("\n");
  if (outText !== rawText) {
    await fsp.writeFile(ymlPath, outText, "utf8");
    lastYamlRaw = outText; // aggiorna cache
    output.appendLine(`Aggiornato: ${ymlPath}`);
  } else {
    output.appendLine(`Nessuna modifica da scrivere: ${ymlPath}`);
  }
}

// -----------------------------------------
// PROVIDER (Hover & Definition)
// -----------------------------------------
function pickWord(doc: vscode.TextDocument, pos: vscode.Position): string | undefined {
  const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_][A-Za-z0-9_]*/);
  return range ? doc.getText(range) : undefined;
}

function registerProviders(context: vscode.ExtensionContext) {
  const cfg = getCfg();

  // YAML Hover
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ language: "yaml", scheme: "file" }, { language: "yaml", scheme: "untitled" }],
      {
        provideHover(doc, pos) {
          const word = pickWord(doc, pos);
          if (!word) return;
          const f = formulaIndex.get(word);
          if (!f) return;

          const out: string[] = [];
          out.push(`### ${f.key}${f.unit ? `  \n*Unità:* \`${f.unit}\`` : ""}`);
          if (f.formula) out.push(`**Formula:** \`${f.formula}\``);
          if (f.expanded && f.expanded !== f.formula) 
          out.push(`**Espansa:** \`${f.expanded}\``);
          if (typeof f.valueCalc === "number")
          out.push(`**Calcolato:** \`${f.valueCalc}\``);

          if (f.steps?.length) {
            out.push("\n**Steps:**");
            for (const s of f.steps) out.push(`- ${s}`);
          }
            
          return new vscode.Hover(new vscode.MarkdownString(out.join("\n\n")));
        }
      }
    )
  );

  // YAML Definition
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      [{ language: "yaml", scheme: "file" }, { language: "yaml", scheme: "untitled" }],
      {
        provideDefinition(doc, pos) {
            const word = pickWord(doc, pos);
            if (!word) return;
            const f = formulaIndex.get(word);
          if (!f || !workspaceRoot) return;

          const file = path.resolve(workspaceRoot, f._filePath ?? "");
          const uri = vscode.Uri.file(file);
          const line = f._line ?? 0;
          return new vscode.Location(uri, new vscode.Range(line, 0, line, 0));
        }
      }
    )
  );


  // C/C++ opzionali (fallback)
  if (cfg.enableCppProviders) {
    const cppSel = [
      { language: "c", scheme: "file" },
      { language: "cpp", scheme: "file" },
      { language: "c", scheme: "untitled" },
      { language: "cpp", scheme: "untitled" },
    ];

    // HOVER C/C++ (solo se tu hai qualcosa da mostrare, NO async, NO executeHoverProvider)
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(cppSel, {
        provideHover(doc, pos) {
          const word = pickWord(doc, pos);
          if (!word) return;
          const f = formulaIndex.get(word);
          if (!f) return;

          const out: string[] = [];
          out.push(`### ${f.key}${f.unit ? `  \n*Unità:* \`${f.unit}\`` : ""}`);
          if (f.formula) 
            out.push(`**Formula:** \`${f.formula}\``);
          if (f.expanded && f.expanded !== f.formula) 
            out.push(`**Espansa:** \`${f.expanded}\`` + (typeof f.valueCalc === "number" ? ` → \`${f.valueCalc}\`` : ""));

          if (f.steps?.length) {
            out.push("\n**Steps:**");
            for (const s of f.steps) out.push(`- ${s}`);
          }

          // const msg = new vscode.MarkdownString(
          //   `**${f.key}** = \`${f.expanded ?? f.formula ?? ""}\`` +
          //   (typeof f.valueCalc === "number" ? ` → \`${f.valueCalc}\`` : "")
          // );
          const msg = new vscode.MarkdownString(out.join("\n\n"));
          msg.isTrusted = true;
          return new vscode.Hover(msg);
        }
      })
    );

    // DEFINITION C/C++ (fallback)
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(cppSel, {
        provideDefinition(doc, pos) {
            const word = pickWord(doc, pos);
            if (!word || !workspaceRoot) return;
            
            const f = formulaIndex.get(word);
            if (f) {
              const file = path.resolve(workspaceRoot, f._filePath ?? "");
              return new vscode.Location(
              vscode.Uri.file(file),
                new vscode.Range(f._line ?? 0, 0, f._line ?? 0, 0)
              );
            }

            const loc = symbolDefs.get(word);
            if (loc) {
                const file = path.resolve(workspaceRoot, loc.file);
                return new vscode.Location(
                  vscode.Uri.file(file),
                  new vscode.Range(loc.line, 0, loc.line, 0)
                );
          }
        }
      })
    );
  }
}

// ============================================================
// JUMP COMMAND — YAML ⇄ C/C++
// ============================================================

function getActiveWord() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const pos = editor.selection.active;
  const word = pickWord(doc, pos);
  if (!word) return;
  return { editor, word };
}

async function reveal(uri: vscode.Uri, line: number) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const ed  = await vscode.window.showTextDocument(doc, { preview: true });
  const r = new vscode.Range(line, 0, line, 0);
  ed.selection = new vscode.Selection(r.start, r.end);
  ed.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function cmdGoToCounterpart() {
  const ctx = getActiveWord();
  if (!ctx) return;
  const { editor, word } = ctx;
  const lang = editor.document.languageId;

  // C/C++ → YAML
  if (lang === "c" || lang === "cpp") {
    const f = formulaIndex.get(word);
    if (f) {
      const file = path.resolve(workspaceRoot, f._filePath ?? "");
      return reveal(vscode.Uri.file(file), f._line ?? 0);
    }
    const loc = symbolDefs.get(word);
    if (loc) {
      const file = path.resolve(workspaceRoot, loc.file);
      return reveal(vscode.Uri.file(file), loc.line);
    }
    return;
  }

  // YAML → C/C++
  if (lang === "yaml") {
    const loc = symbolDefs.get(word);
    if (loc) {
      const file = path.resolve(workspaceRoot, loc.file);
      return reveal(vscode.Uri.file(file), loc.line);
    }
  }
}

// ==============================================================
// CODELENS C/C++ (solo valore numerico)
// ==============================================================
async function openFormulaDefinition(key: string) {
    const f = formulaIndex.get(key);
    if (!f || !f._filePath) {
        vscode.window.showWarningMessage(`Nessuna voce formulas per '${key}'`);
        return;
    }

    const file = path.resolve(workspaceRoot, f._filePath);
    const line = f._line ?? 0;

    const doc = await vscode.workspace.openTextDocument(file);
    const ed  = await vscode.window.showTextDocument(doc, { preview: false });

    const r = new vscode.Range(line, 0, line, 0);
    ed.selection = new vscode.Selection(r.start, r.end);
    ed.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

class CppValueCodeLensProvider implements vscode.CodeLensProvider {
    private emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.emitter.event;

    refresh() { this.emitter.fire(); }

    provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const lines = doc.getText().split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            // output.appendLine(`"${l}" <---`);

            // 1) #define NAME EXPR
            const m1 = l.match(/^\s*#define\s+([A-Za-z_]\w*)\s+(.+)$/);
            if (m1) {
                const name = m1[1];
                const expr = m1[2];

                // prova a valutare
                const v = evaluateComposite(expr);

                // Mostra SOLO se "composta" (operatori o dipendenze), NON se numero semplice
                if (!isCompositeExpression(expr)) {
                  // Se esiste una formula YAML che corrisponde allo stesso nome:
                  const f = formulaIndex.get(name);
                  let mismatch = false;
                  // output.appendLine(`eval "${name}" with expr "${expr}" for f=${f}`);

                  if (f && typeof f.valueCalc === "number" && typeof v === "number") {
                      const diff = Math.abs(f.valueCalc - v) / f.valueCalc;
                      // output.appendLine(`eval diff ${name} = ${diff} (${f.valueCalc} / ${v})`);

                      if (diff > 0.01) {
                          // differenza significativa → segnala mismatch
                          mismatch = true;
                      }
                  }

                  if (mismatch) {
                      lenses.push(new vscode.CodeLens(
                          new vscode.Range(i, 0, i, 0),
                          {
                              title: f? `❗ CalcDocs: ${name} different from its formula of ${f?.valueCalc} (click to open)` : `❗ ✨ CalcDocs: ${name} need to be checked (click to open)`,
                              command: "calcdocs.fixMismatch",
                              arguments: [name]
                          }
                      ));

                  };
                  
                  continue;
                }

                if (typeof v === "number") {
                  // caso “normale”: definizione composta risolta → mostra solo valore
                  lenses.push(new vscode.CodeLens(
                      new vscode.Range(i, 0, i, 0),
                      {
                          title: `CalcDocs: ${name} = ${v}`,
                          command: ""   // non cliccabile
                      }
                  ));
                }
                
                continue;
            }

            // 2) const TYPE NAME = EXPR;
            const m2 = l.match(/^\s*(?:static\s+)?const\s+[A-Za-z0-9_]+\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
            if (m2) {
                const name = m2[1];
                const expr = m2[2];

                // prova a valutare
                const v = evaluateComposite(expr);

                if (!isCompositeExpression(expr)) {
                  // Se esiste una formula YAML che corrisponde allo stesso nome:
                  const f = formulaIndex.get(name);
                  let mismatch = false;
                  // output.appendLine(`eval "${name}" with expr "${expr}" for f=${f}`);

                  if (f && typeof f.valueCalc === "number" && typeof v === "number") {
                      const diff = Math.abs(f.valueCalc - v) / f.valueCalc;
                      // output.appendLine(`eval diff ${name} = ${diff} (${f.valueCalc} / ${v})`);

                      if (diff > 0.01) {
                          // differenza significativa → segnala mismatch
                          mismatch = true;
                      }
                  }

                  if (mismatch) {
                      lenses.push(new vscode.CodeLens(
                          new vscode.Range(i, 0, i, 0),
                          {
                              title: f? `❗ CalcDocs: ${name} different from its formula of ${f?.valueCalc} (click to open)` : `❗ ✨ CalcDocs: ${name} need to be checked (click to open)`,
                              command: "calcdocs.fixMismatch",
                              arguments: [name]
                          }
                      ));

                  };
                  
                  continue;
                }

                if (typeof v === "number") {
                  // caso “normale”: definizione composta risolta → mostra solo valore
                  lenses.push(new vscode.CodeLens(
                      new vscode.Range(i, 0, i, 0),
                      {
                          title: `CalcDocs: ${name} = ${v}`,
                          command: ""   // non cliccabile
                      }
                  ));
                }
            }
        }

        return lenses;
    }
}

// ==============================================================
// WATCHERS & PERIODIC
// ============================================================

let watchers: vscode.FileSystemWatcher[] = [];

function disposeWatchers() {
  for (const w of watchers) w.dispose();
  watchers = [];
}

function registerWatchers(context: vscode.ExtensionContext) {
  disposeWatchers();
  const cfg = getCfg();

  if (cfg.scanInterval === 0) {
    // output.appendLine("[CalcDocs] watchers DISABILITATI (scanInterval = 0)");
    return;  // <-- evita di creare watchers
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) return;

  const exts = cfg.enableCppProviders
    ? "**/*.{yaml,yml,c,cpp,h,hpp,cc,hh}"
    : "**/*.{yaml,yml}";

  for (const f of folders) {
    const pat = new vscode.RelativePattern(f, exts);
    const w = vscode.workspace.createFileSystemWatcher(pat);

    const bounce = (uri: vscode.Uri) => {
      if (!isIgnoredUri(uri)) scheduleAnalysis(250);
    };
    
    w.onDidCreate(bounce);
    w.onDidChange(bounce);
    w.onDidDelete(bounce);

    watchers.push(w);
    context.subscriptions.push(w);
  }
}

function scheduleAnalysis(delay: number) {
  if (analysisTimer) clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    if (workspaceRoot) runAnalysis(workspaceRoot);
  }, delay);
}

function setupPeriodic() {
  const { scanInterval } = getCfg();
  ANALYSIS_INTERVAL_MS = scanInterval > 0 ? scanInterval * 1000 : 0;

  if (analysisTimer) clearInterval(analysisTimer as any);

  if (scanInterval === 0) {
    // output.appendLine("[CalcDocs] periodic scan DISABILITATO");
    disposeWatchers();
    return;
  }

  if (ANALYSIS_INTERVAL_MS > 0) {
    analysisTimer = setInterval(() => scheduleAnalysis(0), ANALYSIS_INTERVAL_MS) as any;
  }
}

// -----------------------------------------
// UI & COMANDI
// -----------------------------------------
function updateStatusBar() {
  if (statusBar) {
    statusBar.text = `$(symbol-operator) CalcDocs: ${formulaIndex.size}`;
    statusBar.tooltip = "Formule indicizzate";
  }
}

async function cmdForceRefresh() {
  if (!workspaceRoot) return;
  await runAnalysis(workspaceRoot);
  if (lastYamlPath && lastYamlRaw) {
    await writeBackYaml(lastYamlPath, lastYamlRaw);
  }
  vscode.window.showInformationMessage("CalcDocs aggiornato.");
}

async function cmdSetScanInterval() {
  const { scanInterval } = getCfg();
  const val = await vscode.window.showInputBox({
    prompt: "Intervallo scansione (secondi), 0 = disattivato",
    value: String(scanInterval),
    validateInput(str) {
      const n = Number(str);
      return (!Number.isFinite(n) || n < 0) ? "Inserisci >= 0" : null;
    }
  });
  if (val == null) return;
  const n = Number(val);
  await vscode.workspace.getConfiguration("calcdocs")
    .update("scanInterval", n, vscode.ConfigurationTarget.Workspace);
  setupPeriodic();
}


// -----------------------------------------
// ACTIVATE / DEACTIVATE
// -----------------------------------------
export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(output);
  output.appendLine("[activate] CalcDocs");

  // Root
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) workspaceRoot = folders[0].uri.fsPath;

  // 👉 Prima analisi: PRIMA dei provider, così hover/def funzionano sempre
  if (workspaceRoot) await runAnalysis(workspaceRoot);

  registerProviders(context);

  // ---- CodeLens C/C++ (solo se il valore è noto) ----
  const cppCodeLensProvider = new CppValueCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "c", scheme: "file" },
        { language: "cpp", scheme: "file" },
        { language: "c", scheme: "untitled" },
        { language: "cpp", scheme: "untitled" },
        { language: "c", scheme: "vscode-userdata" },
        { language: "cpp", scheme: "vscode-userdata" },
        // compatibilità incluse:
        { language: "plaintext", scheme: "file" }
      ],
      cppCodeLensProvider
    )
  );

  // Refresh CodeLens quando serve
  const refreshCL = () => cppCodeLensProvider.refresh();
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => refreshCL())
  );

  // Watchers
  registerWatchers(context);
  // Periodic
  setupPeriodic();

  // UI
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(refresh) CalcDocs";
  statusBar.command = "calcdocs.forceRefresh";
  context.subscriptions.push(statusBar);

  // status bar update visibility
  updateStatusBarVisibility();

  // Comandi
  context.subscriptions.push(
    vscode.commands.registerCommand("calcdocs.forceRefresh", cmdForceRefresh),
    vscode.commands.registerCommand("calcdocs.setScanInterval", cmdSetScanInterval),
    vscode.commands.registerCommand("calcdocs.goToCounterpart", cmdGoToCounterpart),
    vscode.commands.registerCommand("calcdocs.fixMismatch", async (label: string) => {
      openFormulaDefinition(label);
    })
  );
}

export async function deactivate() {
  disposeWatchers();
  if (analysisTimer) clearTimeout(analysisTimer);
  output.appendLine("[deactivate] CalcDocs");
  output.dispose();
  statusBar?.dispose();
}
