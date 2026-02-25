// server.ts
import * as fsp from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  createConnection,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  Hover,
  MarkupKind,
  Position,
  Location,
  Range
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath, pathToFileURL } from "url";
import { Dirent } from "fs";

// --------------------------- Stato ---------------------------
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot = "";
let ANALYSIS_INTERVAL = 30000;
let analysisTimer: NodeJS.Timeout | null = null;
let lastYamlPath = "";
let lastYamlRaw = "";

type FormulaEntry = {
  key: string;
  unit?: string;
  formula?: string;
  dati?: string;
  steps: string[];
  valueYaml?: number;
  expanded?: string;
  valueCalc?: number | null;
  _filePath?: string;
  _line?: number;
};

const formulaIndex = new Map<string, FormulaEntry>();
const symbolValues = new Map<string, number>(); // variabili note (YAML value + const/define)
const symbolDefs = new Map<string, { file: string; line: number }>(); // dove è definito (C)

// --------------------------- Utils FS ---------------------------
const SRC_EXTS = new Set([".c", ".h", ".cpp", ".hpp", ".cc", ".hh"]);

// const IGNORED_DIRS = new Set([
//   ".git", "node_modules", "dist", "build", "out", "__pycache__", ".vscode", ".idea"
// ]);
let IGNORED_DIRS = new Set<string>();

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: Dirent<string>[];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
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

function clampLen(s: string, max = 5000) {
  return s.length > max ? s.slice(0, max) + " …" : s;
}

// --------------------------- Parsing/Math ---------------------------
const TOKEN_RX = /[A-Za-z_][A-Za-z0-9_]*/g;
const DEFINE_RX = /^\s*#define\s+([A-Za-z_]\w*)\s+([^\r\n]+?)\s*$/;
const CONST_RX = /\b(?:static\s+)?const\s+(?:unsigned\s+)?(?:long|int|short|char|float|double|uint\d*_t|int\d*_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+)/g;

function stripComments(s: string) {
  const noLine = s.split("//")[0];
  return noLine.replace(/\/\*.*?\*\//g, "").trim();
}

function cleanLiteralSuffixes(expr: string): string {
  return expr.replace(/(?<=\d)(ul|lu|ull|llu|u|l|ll|f)\b/gi, "");
}

function safeEval(expr: string): number {
  const cleaned = cleanLiteralSuffixes(expr);
  // L'espressione qui dovrebbe contenere solo numeri/operatori dopo la sostituzione token.
  const fn = new Function(`"use strict"; return (${cleaned});`);
  const val = fn();
  if (typeof val !== "number" || !Number.isFinite(val)) throw new Error("non-numeric");
  return val;
}

function replaceTokens(expr: string, values: Map<string, number>): string {
  if (!expr) return expr;
  return expr.replace(TOKEN_RX, (tok) => (values.has(tok) ? String(values.get(tok)) : tok));
}

async function collectDefinesAndConsts(files: string[], root: string) {
  const defines = new Map<string, string>();
  const consts = new Map<string, number>();
  const locations = new Map<string, { file: string; line: number }>();

  for (const file of files) {
    if (!SRC_EXTS.has(path.extname(file).toLowerCase())) continue;

    let text: string;
    try { text = await fsp.readFile(file, "utf8"); } catch { continue; }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(DEFINE_RX);
      if (m) {
        const name = m[1];
        const expr = stripComments(m[2]);
        if (!name.includes("(") && !defines.has(name)) {
          defines.set(name, expr);
          locations.set(name, { file: path.relative(root, file), line: i });
          // connection.console.log("FOUND DEFINE:" + name + "=" + expr);
        }
      }
    }

    for (const match of text.matchAll(CONST_RX)) {
      const name = match[1];
      const expr = stripComments(match[2]);
      try {
        const val = safeEval(expr);
        if (!consts.has(name)) {
          consts.set(name, val);
          const line = lines.findIndex((l) => l.includes(name));
          locations.set(name, { file: path.relative(root, file), line: Math.max(0, line) });
        }
      } catch {
        // ignore non-evaluable
      }
    }
  }

  return { defines, consts, locations };
}

async function writeBackYaml(ymlPath: string, rawText: string) {
  const originalLines = rawText.split(/\r?\n/);
  const lines = [...originalLines];

  let changed = false;

  // connection.console.log(`WRITEBACK: start. formule indicizzate = ${formulaIndex.size}`);

  for (const [key, entry] of formulaIndex.entries()) {

    // ========== 1) Validazione posizione nel file ==========
    const lineIndex = typeof entry._line === "number" ? entry._line : -1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      connection.console.error(`WRITEBACK: salto '${key}' perché _line=${entry._line}`);
      continue;
    }

    // connection.console.log(`WRITEBACK: '${key}' @ riga ${lineIndex} → "${lines[lineIndex] ?? ""}"`);

    // ------------------------------
    // 1) Calcola indentazione corretta
    // ------------------------------
    const keyLine = lines[lineIndex];
    const keyIndent = (keyLine.match(/^\s*/) || [""])[0];   // indent key
    const fieldIndent = keyIndent + "  ";                   // indent correct inner fields

    // ------------------------------
    // 2) Scansiona blocco YAML del nodo
    // ------------------------------
    let ptr = lineIndex + 1;
    let valueLineIndex = -1;
    let datiLineIndex = -1;

    // Regex robusti:
    const RX_VALUE = /^\s*value\s*:/i;
    const RX_DATI  = /^\s*dati\s*:/i;
    const RX_FORMULA = /^\s*formula\s*:/i;

    while (ptr < lines.length) {
      const curr = lines[ptr];
      const trimmed = curr.trim();
      const isEmpty = trimmed.length === 0;
      const isIndented = /^\s+/.test(curr);

      // nuova chiave top-level → esci
      if (!isEmpty && !isIndented) break;

      if (RX_VALUE.test(curr)) valueLineIndex = ptr;
      else if (RX_DATI.test(curr)) datiLineIndex = ptr;

      ptr++;
    }

    const blockStart = lineIndex + 1;
    const blockEnd = ptr;
    // connection.console.log(`WRITEBACK: blocco '${key}' → range ${lineIndex + 1}..${blockEnd - 1}, indent="${blockIndent.replace(/\t/g,'\\t')}"`);

    // ------------------------------
    // 3) Scrittura/aggiornamento dati:
    // ------------------------------
    if (entry.expanded) {
      const newDati = `${fieldIndent}dati: ${entry.expanded}`;

      if (datiLineIndex >= 0) {
        if (lines[datiLineIndex] !== newDati) {
          lines[datiLineIndex] = newDati;
          changed = true;
          connection.console.log(`WRITEBACK: aggiornato 'dati' di ${key}`);
        }
      } else {
        // Inserisci prima di formula:
        let formulaIdx = -1;
        for (let i = blockStart; i < blockEnd; i++) {
          if (RX_FORMULA.test(lines[i])) {
            formulaIdx = i;
            break;
          }
        }
        const insertAt = formulaIdx >= 0 ? formulaIdx : blockStart;
        lines.splice(insertAt, 0, newDati);
        changed = true;

        // aggiorna indici
        if (valueLineIndex >= 0 && valueLineIndex >= insertAt) valueLineIndex++;

        connection.console.log(`WRITEBACK: inserito 'dati' di ${key} a riga ${insertAt}`);
      }

    } else {
      // connection.console.warn(`WRITEBACK: nessun 'expanded' per ${key} (dati non scritto)`);
    }

    // ------------------------------
    // 4) Scrittura/aggiornamento value:
    // ------------------------------
    if (entry.valueCalc != null) {
      const newValue = `${fieldIndent}value: ${entry.valueCalc}`;

      // Controllo ulteriore nel range blocco (safety)
      if (valueLineIndex < 0) {
        for (let i = blockStart; i < blockEnd; i++) {
          if (RX_VALUE.test(lines[i])) {
            valueLineIndex = i;
            break;
          }
        }
      }

      if (valueLineIndex >= 0) {
        if (lines[valueLineIndex] !== newValue) {
          lines[valueLineIndex] = newValue;
          changed = true;
          connection.console.log(`WRITEBACK: aggiornato 'value' di ${key}`);
      }
      } else {
        // non esiste -> inserisci
        let insertAt = blockStart;

        // Se esiste dati, value va sotto:
        if (datiLineIndex >= 0) {
          insertAt = datiLineIndex + 1;
        }
        const newLine = newValue;
        lines.splice(insertAt, 0, newLine);
        changed = true;
        connection.console.log(`WRITEBACK: inserito 'value' di ${key} a riga ${insertAt}`);
      }

    } else {
      // connection.console.log(`WRITEBACK: valueCalc assente per ${key} (value non scritto)`);
    }
  }

  // ------------------------------
  // 5) Scrittura finale file
  // ------------------------------
  const outText = lines.join("\n");

  if (outText === rawText) {
    connection.console.log("WRITEBACK: nessuna modifica rilevata → skip scrittura");
    return; // niente write
  }

  // ========== SCRITTURA FINALE ==========
  await fsp.writeFile(ymlPath, outText, "utf8");
  // Aggiorna copia locale
  lastYamlRaw = outText;
  connection.console.log(`WRITEBACK: file aggiornato → ${ymlPath}`);
}

// --------------------------- Analisi ---------------------------
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getYamlTopLevelLine(yamlText: string, key: string): number {
  const lines = yamlText.split(/\r?\n/);
  // match anche con spazi, indentazione o commenti
  const rx = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(#.*)?$`);
  return lines.findIndex((l) => rx.test(l));
}

function resolveSymbol(
  name: string,
  defines: Map<string, string>,
  resolved: Map<string, number>
): number | null {
  // già risolto?
  if (resolved.has(name)) return resolved.get(name)!;
  // se è già numerico in symbolValues
  if (symbolValues.has(name)) {
    const v = symbolValues.get(name)!;
    resolved.set(name, v);
    return v;
  }

  // se non è una define, non possiamo risolverlo
  if (!defines.has(name)) return null;

  const expr = defines.get(name)!;
  const tokens = expr.match(TOKEN_RX) ?? [];

  let expanded = expr;

  for (const t of tokens) {
    if (t === name) continue; // protezione contro ricorsione infinita

    const v = resolveSymbol(t, defines, resolved);
    if (v != null) {
      expanded = expanded.replace(new RegExp(`\\b${t}\\b`, "g"), String(v));
    }
  }

  try {
    const num = safeEval(expanded);
    resolved.set(name, num);
    symbolValues.set(name, num); // <-- importante: aggiorna map valori globali
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
    if (val != null) {
      out = out.replace(new RegExp(`\\b${t}\\b`, "g"), String(val));
    }
  }
  return out;
}

async function runAnalysis(root: string) {
  try {
    const files = await listFilesRecursive(root);
    // Cerca il primo formulas*.yaml
    const ymlPath = files.find(f => {
      const b = path.basename(f).toLowerCase();
      return (b.startsWith("formula") || b.startsWith("formulas")) && (b.endsWith(".yaml") || b.endsWith(".yml"));
    });

    if (!ymlPath) {
      formulaIndex.clear();
      symbolValues.clear();
      symbolDefs.clear();
      connection.console.warn(`Nessun formulas*.yaml trovato in ${root}`);
      return;
    }
    // Carica YAML
    let rawText: string;
    let yml: any;
    try {
      rawText = await fsp.readFile(ymlPath, "utf8");
      yml = yaml.load(rawText);
    } catch (e: any) {
      connection.console.error("Errore YAML: " + e.message);
      return;
    }
    if (!yml || typeof yml !== "object" || Array.isArray(yml)) {
      connection.console.warn("YAML non è un mapping all'origine.");
      return;
    }

    lastYamlPath = ymlPath;
    lastYamlRaw = rawText;

    // 1) variabili top-level con 'value'
    symbolValues.clear();
    for (const [k, v] of Object.entries<any>(yml)) {
      if (v && typeof v === "object" && "value" in v) {
        const n = Number((v as any).value);
        if (Number.isFinite(n)) symbolValues.set(k, n);
      }
    }
    // connection.console.log(`SYMBOL VALUES: ${JSON.stringify(Array.from(symbolValues.entries()), null, 2)}`);

    // 2) definizioni/const dai sorgenti C (opzionale ma utile)
    const { defines, consts, locations } = await collectDefinesAndConsts(files, root);
    for (const [name, expr] of defines) {
      try {
        const numeric = safeEval(expr);
        symbolValues.set(name, numeric);
        // connection.console.log(`DEFINE NUMERICA → ${name} = ${numeric}`);
      } catch {
        // non è numerica, la lasciamo per espansione simbolica
      }
    }
    for (const [k, v] of consts) symbolValues.set(k, v);
    symbolDefs.clear();
    for (const [k, loc] of locations) symbolDefs.set(k, loc);

    // 3) indicizza le formule
    formulaIndex.clear();

    for (const [key, node] of Object.entries<any>(yml)) {
      if (!node || typeof node !== "object") continue;

      const entry: FormulaEntry = {
        key,
        unit: typeof node.unit === "string" ? node.unit : undefined,
        formula: typeof node.formula === "string" ? node.formula : undefined,
        dati: typeof node.dati === "string" ? node.dati : undefined,
        steps: Array.isArray(node.steps) ? node.steps.map(String) : [],
        valueYaml: Number.isFinite(Number(node.value)) ? Number(node.value) : undefined,
        expanded: undefined,
        valueCalc: null,
        _filePath: path.relative(root, ymlPath),
        _line: getYamlTopLevelLine(rawText, key)
      };
      // Espansione COMPLETA ricorsiva
      if (entry.formula) {
        const resolvedMap = new Map<string, number>();
        // Prima sostituisci i valori YAML + const
        let expanded = replaceTokens(entry.formula, symbolValues);
        // Poi sostituzione ricorsiva delle define
        expanded = expandExpression(expanded, defines, resolvedMap);
        entry.expanded = clampLen(expanded);
        // Se ora l'espressione è completamente numerica → eval
        if (!/[A-Za-z_][A-Za-z0-9_]*/.test(expanded)) {
          try { entry.valueCalc = safeEval(expanded); }
          catch { entry.valueCalc = null; }
        }
      }

      formulaIndex.set(key, entry);
    }

    connection.console.log(
      `[${new Date().toLocaleTimeString()}] Indicizzazione completata (${formulaIndex.size} formule)`
    );

  } catch (err: any) {
    connection.console.error("Analysis error: " + err.message);
  }
}

// --------------------------- Pianificazione ---------------------------
function schedulePeriodicAnalysis() {
  if (!workspaceRoot) return;
  // run immediato
  void runAnalysis(workspaceRoot);
  // periodico
  if (analysisTimer) clearInterval(analysisTimer);
  analysisTimer = setInterval(() => void runAnalysis(workspaceRoot), ANALYSIS_INTERVAL);
}

// --------------------------- LSP lifecycle ---------------------------
connection.onInitialize((params: InitializeParams): InitializeResult => {
  if (params.workspaceFolders?.length) {
    // URI -> filesystem path
    workspaceRoot = fileURLToPath(params.workspaceFolders[0].uri);
  } else if (params.rootUri) {
    workspaceRoot = fileURLToPath(params.rootUri);
  } else {
    workspaceRoot = "";
  }

  schedulePeriodicAnalysis();

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      definitionProvider: true
    }
  };
});

connection.onInitialized(() => {
  connection.console.log("CalcDocs server inizializzato.");

  // Notifiche dal client
  connection.onNotification("calcdocs.forceRefresh", async () => {
    await runAnalysis(workspaceRoot);
    // Se abbiamo trovato formulas.yaml e lo abbiamo caricato:
    if (lastYamlPath && lastYamlRaw) {
      await writeBackYaml(lastYamlPath, lastYamlRaw);
    }
  });

  connection.onNotification("calcdocs.updateInterval", (scanInterval: number) => {
    if (isFinite(scanInterval) && scanInterval >= 30) {
      ANALYSIS_INTERVAL = scanInterval * 1000;
      schedulePeriodicAnalysis();
    }
  });

  connection.onNotification("calcdocs.updateSettings", (params: {
    scanInterval?: number;
    ignoredDirs?: string[];
  }) => {
    if (params.scanInterval && params.scanInterval >= 30) {
      ANALYSIS_INTERVAL = params.scanInterval * 1000;
      schedulePeriodicAnalysis();
    }

    if (Array.isArray(params.ignoredDirs)) {
      IGNORED_DIRS = new Set(params.ignoredDirs);
    }
  });
});


// --------------------------- Hover ---------------------------
function getWord(doc: TextDocument, pos: Position) {
  const text = doc.getText();
  const off = doc.offsetAt(pos);
  let s = off, e = off;
  while (s > 0 && /[A-Za-z0-9_]/.test(text[s - 1])) s--;
  while (e < text.length && /[A-Za-z0-9_]/.test(text[e])) e++;
  return text.slice(s, e);
}

connection.onHover((params): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const word = getWord(doc, params.position);
  if (!word) return null;

  const f = formulaIndex.get(word);
  if (!f) return null;

  const lines: string[] = [];
  lines.push(`### ${f.key}${f.unit ? `  \n*Unità:* \`${f.unit}\`` : ""}`);

  if (f.formula) lines.push(`**Formula:** \`${f.formula}\``);
  if (f.expanded && f.expanded !== f.formula) lines.push(`**Espansa:** \`${f.expanded}\``);
  // valori
  const parts: string[] = [];
  if (typeof f.valueCalc === "number") parts.push(`**Calcolato:** \`${f.valueCalc}\``);
  if (parts.length) lines.push(parts.join("  \n"));

  if (f.steps?.length) {
    lines.push("\n**Steps:**");
    for (const s of f.steps) lines.push(`- ${s}`);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: lines.join("\n\n") }
  };
});

// --------------------------- Definition ---------------------------
connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !workspaceRoot) return null;

  const word = getWord(doc, params.position);
  if (!word) return null;

  //
  // 1) Se il simbolo è una formula YAML → salta nel file formulas*.yaml
  //
  const f = formulaIndex.get(word);
  if (f) {
    // troviamo il file formulas*.yaml realmente usato
    const targetFile = path.resolve(workspaceRoot, f._filePath ?? "");
    const uri = pathToFileURL(targetFile).href;     // <-- IMPORTANTISSIMO: usa .href
    const line = (typeof f._line === "number" && f._line >= 0 ? f._line : 0);
    return Location.create(
      uri,
      Range.create(
        Position.create(line, 0),
        Position.create(line, 0)
      )
    );
  }
  //
  // 2) Se è una costante/define → salta nel file sorgente
  //
  const loc = symbolDefs.get(word);
  if (!loc || !workspaceRoot) return null;

  const targetPath = path.resolve(workspaceRoot, loc.file);
  const uri = pathToFileURL(targetPath).href;

  return Location.create(
    uri,
    Range.create({ line: loc.line, character: 0 }, { line: loc.line, character: 0 })
  );
});

documents.listen(connection);
connection.listen();