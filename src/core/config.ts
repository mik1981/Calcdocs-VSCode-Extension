import * as vscode from "vscode";

import { CalcDocsState } from "./state";
import { LogLevel } from "../utils/output";

/**
 * Modalità di visualizzazione dello stato delle risorse nella status bar.
 * - "always": mostra sempre le statistiche di utilizzo
 * - "aboveCpuThreshold": mostra solo quando la CPU supera la soglia
 */
export type ResourceStatusMode = "always" | "aboveCpuThreshold";

/**
 * Livello di diagnostica per inline calc.
 * - "off": nessuna diagnostica
 * - "errors": solo errori
 * - "warnings": errori + warning
 * - "info": errori + warning + info
 */
export type InlineCalcDiagnosticsLevel = "off" | "errors" | "warnings" | "info";

/**
 * Opzioni per il separatore delle migliaia nei numeri formattati.
 * - "none": nessun separatore
 * - "space": spazio (standard scientifico)
 * - "dot": punto alto (⋅, U+22C5) - default precedente
 * - "comma": virgola (USA, UK)
 * - "apostrophe": apostrofo (Svizzera)
 * - "narrowNoBreakSpace": narrow no-break space (U+202F)
 */
export type ThousandsSeparator = "none" | "space" | "dot" | "comma" | "apostrophe" | "narrowNoBreakSpace";

/**
 * Configurazione dell'estensione CalcDocs.
 * Rappresenta tutte le impostazioni modificabili dall'utente.
 */
export type CalcDocsConfig = {
  /** True se l'estensione è abilitata, false se disabilitata */
  enabled: boolean;
  /** Intervallo di scansione in secondi (0 = disabilitato) */
  scanInterval: number;
  /** Lista di directory da ignorare durante la scansione */
  ignoredDirs: string[];
  /** True se i provider C/C++ sono abilitati */
  enableCppProviders: boolean;
  /** Modalità di visualizzazione dello stato risorse */
  resourceStatusMode: ResourceStatusMode;
  /** Soglia CPU percentuale per il warning */
  resourceCpuThreshold: number;
  /** Separatore delle migliaia per i numeri formattati */
  thousandsSeparator: ThousandsSeparator;
  /** livello di log nell'output console */
  internalDebugMode: LogLevel;
  /** Numero massimo di file C/C++ preprocessati mantenuti in cache LRU */
  cppCacheMaxEntries: number;
  /** Abilita/disabilita i CodeLens per inline calc nei commenti */
  inlineCalcEnableCodeLens: boolean;
  /** Abilita/disabilita l'hover per inline calc nei commenti */
  inlineCalcEnableHover: boolean;
  /** Livello di severità per la diagnostica inline calc */
  inlineCalcDiagnosticsLevel: InlineCalcDiagnosticsLevel;
};

/**
 * Legge le impostazioni dell'estensione da "calcdocs.*" e normalizza i valori di default.
 * 
 * @returns Oggetto di configurazione con i valori attuali
 */
export function getConfig(): CalcDocsConfig {
  const cfg = vscode.workspace.getConfiguration("calcdocs");
  
  // Leggi l'intervallo di scansione
  const scanInterval = Number(cfg.get<number>("scanInterval", 0));
  
  // Leggi la modalità di visualizzazione risorse
  const resourceStatusModeValue = cfg.get<string>("resourceStatusMode", "always");
  
  // Leggi la soglia CPU
  const rawCpuThreshold = Number(cfg.get<number>("resourceCpuThreshold", 70));

  // Normalizza la modalità risorse
  const resourceStatusMode: ResourceStatusMode =
    resourceStatusModeValue === "aboveCpuThreshold"
      ? "aboveCpuThreshold"
      : "always";
  
  // Normalizza la soglia CPU (tra 0 e 100)
  const resourceCpuThreshold = Number.isFinite(rawCpuThreshold)
    ? Math.min(100, Math.max(0, rawCpuThreshold))
    : 70;

  // Leggi il separatore delle migliaia
  const thousandsSeparatorValue = cfg.get<string>("thousandsSeparator", "space");
  const thousandsSeparator: ThousandsSeparator = 
    ["none", "space", "dot", "comma", "apostrophe", "narrowNoBreakSpace"].includes(thousandsSeparatorValue)
      ? thousandsSeparatorValue as ThousandsSeparator
      : "space";

  // Leggi il livello di log
  const internalDebugModeValue = cfg.get<string>("internalDebugMode", "");
  const internalDebugMode: LogLevel = internalDebugModeValue as LogLevel;
  const rawCppCacheMaxEntries = Number(cfg.get<number>("cppCacheMaxEntries", 24));
  const cppCacheMaxEntries = Number.isFinite(rawCppCacheMaxEntries)
    ? Math.max(1, Math.floor(rawCppCacheMaxEntries))
    : 24;
  const inlineCalcEnableCodeLens = cfg.get<boolean>(
    "inlineCalc.enableCodeLens",
    true
  );
  const inlineCalcEnableHover = cfg.get<boolean>(
    "inlineCalc.enableHover",
    true
  );
  const inlineCalcDiagnosticsLevelValue = cfg.get<string>(
    "inlineCalc.diagnosticsLevel",
    "warnings"
  );
  const inlineCalcDiagnosticsLevel: InlineCalcDiagnosticsLevel =
    inlineCalcDiagnosticsLevelValue === "off" ||
    inlineCalcDiagnosticsLevelValue === "errors" ||
    inlineCalcDiagnosticsLevelValue === "warnings" ||
    inlineCalcDiagnosticsLevelValue === "info"
      ? inlineCalcDiagnosticsLevelValue
      : "warnings";
    // ["none", "space", "dot", "comma", "apostrophe", "narrowNoBreakSpace"].includes(internalDebugModeValue)
    //   ? internalDebugModeValue as LogLevel
    //   : "";

  return {
    enabled: cfg.get<boolean>("enabled", true),
    scanInterval:
      Number.isFinite(scanInterval) && scanInterval >= 0 ? scanInterval : 0,
    ignoredDirs: cfg.get<string[]>("ignoredDirs", []),
    enableCppProviders: cfg.get<boolean>("enableCppProviders", true),
    resourceStatusMode,
    resourceCpuThreshold,
    thousandsSeparator,
    internalDebugMode,
    cppCacheMaxEntries,
    inlineCalcEnableCodeLens,
    inlineCalcEnableHover,
    inlineCalcDiagnosticsLevel,
  };
}

/**
 * Ricostruisce il set delle directory ignorate all'interno dello stato condiviso
 * dalla configurazione corrente.
 * 
 * @param state - Stato corrente dell'estensione
 * @param config - Configurazione da utilizzare (default: getConfig())
 */
export function refreshIgnoredDirs(
  state: CalcDocsState,
  config: CalcDocsConfig = getConfig()
): void {
  state.ignoredDirs = new Set(config.ignoredDirs);
}

/**
 * Normalizza un percorso filesystem per il confronto.
 * Converte backslash in slash, rimuove slash doppi e converte in minuscolo.
 * 
 * @param value - Percorso da normalizzare
 * @returns Percorso normalizzato
 */
function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

/**
 * Rimuove gli slash iniziali e finali da un percorso.
 * 
 * @param value - Percorso da trimmmare
 * @returns Percorso senza slash iniziali/finali
 */
function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Rimuove il prefisso del drive da un percorso Windows.
 * Esempio: "C:\project" -> "\project"
 * 
 * @param value - Percorso con drive
 * @returns Percorso senza drive
 */
function stripDrivePrefix(value: string): string {
  return value.replace(/^[a-z]:/i, "");
}

/**
 * Escape dei caratteri speciali regex in una stringa.
 * 
 * @param value - Stringa da escapare
 * @returns Stringa con caratteri speciali escapati
 */
function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${()|[\]\\]/g, "\\$&");
}

/**
 * Converte un pattern di segmento glob (senza slash) in regex.
 * Supporta * (qualunque cosa) e ? (un carattere).
 * 
 * @param segmentPattern - Pattern del segmento (es. "build" o "Debug*")
 * @returns Regex compilata per il match
 */
function segmentGlobToRegex(segmentPattern: string): RegExp {
  let regex = "^";

  for (let i = 0; i < segmentPattern.length; i += 1) {
    const char = segmentPattern[i];

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += escapeRegexLiteral(char);
  }

  regex += "$";
  return new RegExp(regex);
}

/**
 * Converte un pattern di percorso glob in regex.
 * Supporta * (qualunque cosa), ** (ricorsivo) e ? (un carattere).
 * 
 * @param pathPattern - Pattern del percorso (es. "**{barra}temp{barra}**")
 * @returns Regex compilata per il match
 */
function pathGlobToRegex(pathPattern: string): RegExp {
  let regex = "^";

  for (let i = 0; i < pathPattern.length; i += 1) {
    const char = pathPattern[i];

    if (char === "*") {
      const hasDoubleStar = i + 1 < pathPattern.length && pathPattern[i + 1] === "*";
      if (hasDoubleStar) {
        regex += ".*";
        i += 1;
      } else {
        regex += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += escapeRegexLiteral(char);
  }

  regex += "$";
  return new RegExp(regex);
}

/**
 * Determina se un pattern contiene slash, indicando un pattern di percorso.
 * 
 * @param entry - Pattern da controllare
 * @returns True se contiene slash
 */
function isPathPattern(entry: string): boolean {
  return entry.includes("/");
}

/**
 * Verifica se un percorso normalizzato corrisponde a una entry di ignore.
 * 
 * @param normalizedPath - Percorso normalizzato da controllare
 * @param rawEntry - Entry di ignore (può contenere wildcards)
 * @returns True se il percorso corrisponde all'entry
 */
function matchesIgnoredEntry(normalizedPath: string, rawEntry: string): boolean {
  const normalizedEntry = trimSlashes(normalizePathForMatch(rawEntry));
  if (!normalizedEntry) {
    return false;
  }

  const pathNoDrive = trimSlashes(stripDrivePrefix(normalizedPath));
  if (!pathNoDrive) {
    return false;
  }

  // Se non è un pattern di percorso, matcha solo il segmento finale
  if (!isPathPattern(normalizedEntry)) {
    const segmentRegex = segmentGlobToRegex(normalizedEntry);
    const segments = pathNoDrive.split("/").filter((segment) => segment.length > 0);
    return segments.some((segment) => segmentRegex.test(segment));
  }

  // Pattern di percorso completo
  const pathRegex = pathGlobToRegex(normalizedEntry);
  return pathRegex.test(pathNoDrive) || pathRegex.test(`${pathNoDrive}/`);
}

/**
 * Verifica se un percorso filesystem corrisponde a una delle regole di directory ignorate.
 * Supporta wildcards glob:
 * - "build"      -> qualsiasi cartella chiamata "build"
 * - "Debug*"     -> cartelle con prefisso "Debug"
 * - "**{barra}temp{barra}**" -> qualsiasi percorso contenente "/temp/"
 * 
 * @param state - Stato corrente dell'estensione
 * @param fsPath - Percorso filesystem assoluto da controllare
 * @returns True se il percorso deve essere ignorato
 */
export function isIgnoredFsPath(state: CalcDocsState, fsPath: string): boolean {
  const normalizedPath = normalizePathForMatch(fsPath);

  for (const rawEntry of state.ignoredDirs) {
    if (matchesIgnoredEntry(normalizedPath, rawEntry)) {
      return true;
    }
  }

  return false;
}

/**
 * Verifica se un URI corrisponde a una delle regole di directory ignorate.
 * 
 * @param state - Stato corrente dell'estensione
 * @param uri - URI da controllare
 * @returns True se l'URI deve essere ignorato
 */
export function isIgnoredUri(state: CalcDocsState, uri: vscode.Uri): boolean {
  return isIgnoredFsPath(state, uri.fsPath);
}

/**
 * Converte l'opzione del separatore delle migliaia nel carattere effettivo.
 * 
 * @param separator - Opzione del separatore
 * @returns Il carattere separatore corrispondente
 */
export function getThousandsSeparatorChar(separator: ThousandsSeparator): string {
  switch (separator) {
    case "none":
      return "";
    case "space":
      return " ";
    case "dot":
      return "⋅"; // U+22C5
    case "comma":
      return ",";
    case "apostrophe":
      return "'";
    case "narrowNoBreakSpace":
      return "\u202F"; // Narrow No-Break Space
    default:
      return " ";
  }
}
