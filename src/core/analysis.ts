import * as fsp from "fs/promises";

import { collectDefinesAndConsts } from "./cppParser";
import { listFilesRecursive, findFormulaYamlFile } from "./files";
import {
  createSymbolResolutionStats,
  safeEval,
  replaceTokens,
  expandExpression,
  resolveSymbol,
  resolveInlineLookups,
  type EvaluationContext,
  type SymbolResolutionStats,
  snapshotSymbolResolutionStats,
} from "./expression";
import { loadAdjacentCsvTables } from "./csvTables";
import { loadYaml, buildFormulaEntry, type LoadedYaml } from "./yamlParser";
import { getConfig, isIgnoredFsPath, refreshIgnoredDirs } from "./config";
import { CalcDocsState, type YamlParseErrorInfo } from "./state";
import { type FormulaLabel } from "../types/FormulaEntry";
import { clampLen } from "../utils/text";
import { TOKEN_RX } from "../utils/regex";
import { localize } from "../utils/localize";

/**
 * Risultato dell'analisi del workspace.
 * Indica se il file formulas YAML è cambiato dall'ultima analisi.
 */
export type AnalysisResult = {
  /** True se il file formulas.yaml è stato aggiunto o rimosso */
  hasFormulasFileChanged: boolean;
};

/**
 * Risultato della scansione del workspace.
 * Contiene la lista dei file e il percorso del file YAML trovato.
 */
type WorkspaceScan = {
  /** Lista di tutti i file sorgente nel workspace */
  files: string[];
  /** Percorso del file formulas YAML trovato, undefined se assente */
  yamlPath?: string;
  /** True se lo stato di presenza del file YAML è cambiato */
  hasFormulasFileChanged: boolean;
};

/** Tipo per le entry YAML: coppie chiave-oggetto al primo livello */
type YamlNodeEntries = Array<[string, Record<string, unknown>]>;

/** Tipo di ritorno del parser C/C++ per i simboli */
type CollectedCppSymbols = Awaited<ReturnType<typeof collectDefinesAndConsts>>;

/** Regex per rilevare chiamate a funzioni di lookup CSV/table */
const TABLE_LOOKUP_RX = /\b(?:csv|table|lookup)\s*\(/i;
/** Regex per rilevare chiamate a funzioni in espressioni */
const FUNC_CALL_RX = /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/;
/** Regex per contare operatori matematici nelle espressioni */
const OPERATOR_COUNT_RX = /[+\-*/%&|^~<>?:]/g;
// Usato per distinguere errori generici da stack overflow per ricorsione
const STACK_OVERFLOW_RX = /maximum call stack size exceeded/i;
/** Regex per estrarre linea e colonna dai messaggi di errore YAML di js-yaml */
const YAML_LINE_COLUMN_RX = /line\s+(\d+)\s*,\s*column\s+(\d+)/i;

/**
 * Estrae la posizione (linea e colonna) da un messaggio di errore YAML.
 * 
 * @param message - Messaggio di errore del parser js-yaml
 * @returns Oggetto contenente linea e colonna opzionali
 */
function parseYamlErrorPosition(message: string): {
  line?: number;
  column?: number;
} {
  const match = message.match(YAML_LINE_COLUMN_RX);
  if (!match) {
    return {};
  }

  const line = Number(match[1]);
  const column = Number(match[2]);

  return {
    line: Number.isFinite(line) ? line : undefined,
    column: Number.isFinite(column) ? column : undefined,
  };
}

/**
 * Aggiorna lo stato con le statistiche di utilizzo dello stack.
 * 
 * @param state - Stato corrente dell'estensione
 * @param stackStats - Statistiche di risoluzione simboli
 * @param forceDegraded - Se true, forza lo stato degraded indipendentemente dalle statistiche
 */
function updateStateStackUsage(
  state: CalcDocsState,
  stackStats: SymbolResolutionStats,
  forceDegraded = false
): void {
  const snapshot = snapshotSymbolResolutionStats(stackStats);
  state.lastAnalysisStackUsage = forceDegraded
    ? {
        ...snapshot,
        degraded: true,
      }
    : snapshot;
}

/**
 * Registra nel log le statistiche di utilizzo dello stack se in modalità degradata.
 * Stampa eventuali dipendenze circolari rilevate.
 * 
 * @param state - Stato corrente dell'estensione
 * @param stackStats - Statistiche di risoluzione simboli
 */
function logStackUsageIfNeeded(
  state: CalcDocsState,
  stackStats?: SymbolResolutionStats
): void {
  const usage = state.lastAnalysisStackUsage;

  // Non loggare se tutto OK
  if (!usage.degraded) {
    return;
  }

  state.output.warn(
    localize("output.stackSafeMode", usage.usedDepth, usage.depthLimit, usage.cycleCount, usage.prunedCount)
  );

  // Logga le dipendenze circolari rilevate
  if (usage.cycleCount > 0 && stackStats && stackStats.cycleSamples.length > 0) {
    state.output.warn(localize("output.circularReferences"));
    for (const cycleSample of stackStats.cycleSamples) {
      state.output.detail(`[CalcDocs]   - ${cycleSample}`);
    }
  }
}

/**
 * Orchestrazione principale dell'analisi del workspace.
 * Scansiona i file, decide la modalità (YAML vs solo C/C++) e popola le mappe di stato condivise.
 * 
 * @param state - Stato corrente dell'estensione
 * @returns Risultato dell'analisi con indicazione di cambiamento del file YAML
 */
export async function runAnalysis(state: CalcDocsState): Promise<AnalysisResult> {
  // Oggetto di diagnostica per-run, condiviso da tutte le chiamate di risoluzione simboli/macro
  const stackStats = createSymbolResolutionStats();
  state.lastYamlParseError = null;

  try {
    // Scansiona il workspace per ottenere lista file e trovare YAML
    const workspaceScan = await scanWorkspace(state);

    // Se non c'è un file YAML, esegui solo l'analisi C/C++
    if (!workspaceScan.yamlPath) {
      await runCppOnlyAnalysis(state, workspaceScan.files, stackStats);
      updateStateStackUsage(state, stackStats);
      logStackUsageIfNeeded(state, stackStats);
      return {
        hasFormulasFileChanged: workspaceScan.hasFormulasFileChanged,
      };
    }

    // Carica il file YAML e gestisci eventuali errori di parsing
    const loadedYaml = await loadYamlOrReportError(state, workspaceScan.yamlPath);
    if (!loadedYaml) {
      updateStateStackUsage(state, stackStats);
      return {
        hasFormulasFileChanged: workspaceScan.hasFormulasFileChanged,
      };
    }

    // Esegui l'analisi completa con YAML
    await runYamlAnalysis(
      state,
      workspaceScan.files,
      workspaceScan.yamlPath,
      loadedYaml,
      stackStats
    );
    updateStateStackUsage(state, stackStats);
    logStackUsageIfNeeded(state, stackStats);

    return {
      hasFormulasFileChanged: workspaceScan.hasFormulasFileChanged,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const isStackOverflow = STACK_OVERFLOW_RX.test(message);
    state.output.warn(
      isStackOverflow
        ? localize("output.stackOverflow", message)
        : localize("output.analysisError", message)
    );
    updateStateStackUsage(state, stackStats, isStackOverflow);
    logStackUsageIfNeeded(state, stackStats);

    return {
      hasFormulasFileChanged: false,
    };
  }
}

/**
 * Enumera i file del workspace e aggiorna lo stato di presenza del file formulas YAML.
 * Esempio: toggla la visibilità della status bar quando formulas.yaml appare/scompare.
 * 
 * @param state - Stato corrente dell'estensione
 * @returns Risultato della scansione con file e percorso YAML
 */
async function scanWorkspace(state: CalcDocsState): Promise<WorkspaceScan> {
  const config = getConfig();
  refreshIgnoredDirs(state, config);

  // Lista ricorsiva dei file, saltando le directory ignorate
  const files = await listFilesRecursive(
    state.workspaceRoot,
    (absoluteDirPath) => isIgnoredFsPath(state, absoluteDirPath),
    state
  );

  // Trova il file formulas YAML
  const yamlPath = findFormulaYamlFile(files);
  const previousHasFormulasFile = state.hasFormulasFile;
  state.hasFormulasFile = Boolean(yamlPath);

  return {
    files,
    yamlPath,
    hasFormulasFileChanged: previousHasFormulasFile !== state.hasFormulasFile,
  };
}

/**
 * Modalità fallback usata quando non viene trovato nessun formulas*.yaml.
 * Mantiene i valori e le posizioni dei simboli C/C++ disponibili per hover/definition.
 * 
 * @param state - Stato corrente dell'estensione
 * @param files - Lista dei file da analizzare
 * @param stackStats - Statistiche per la risoluzione simboli
 */
async function runCppOnlyAnalysis(
  state: CalcDocsState,
  files: string[],
  stackStats: SymbolResolutionStats
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  // Raccogli simboli C/C++ dal codice sorgente
  const cppSymbols = await collectDefinesAndConsts(files, state.workspaceRoot);
  applyCppSymbols(state, cppSymbols, {
    resetSymbolValues: true,
    applyConstsBeforeResolve: false,
    requireFiniteResolvedValues: true,
    symbolResolutionStats: stackStats,
  });

  state.output.info(
    localize("output.cppAnalysisComplete", state.symbolValues.size)
  );
}

/**
 * Carica il file YAML e riporta gli errori di parsing al canale di output senza lanciare eccezioni.
 * 
 * @param state - Stato corrente dell'estensione
 * @param yamlPath - Percorso del file YAML da caricare
 * @returns L'oggetto LoadedYaml se il parsing ha successo, null altrimenti
 */
async function loadYamlOrReportError(
  state: CalcDocsState,
  yamlPath: string
): Promise<LoadedYaml | null> {
  try {
    return await loadYaml(yamlPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const position = parseYamlErrorPosition(message);
    const parseError: YamlParseErrorInfo = {
      yamlPath,
      message,
      line: position.line,
      column: position.column,
    };

    state.lastYamlParseError = parseError;

    const locationLabel =
      parseError.line != null && parseError.column != null
        ? `:${parseError.line}:${parseError.column}`
        : "";
    state.output.error(localize("output.yamlError", parseError.yamlPath, locationLabel, parseError.message));
    // Forza l'apertura del pannello CalcDocs per mostrare subito la diagnostica all'utente
    state.output.show(false);
    return null;
  }
}

/**
 * Modalità analisi completa quando esiste il file formulas YAML.
 * Flusso:
 * 1) seeding dei valori numerici noti da YAML
 * 2) merge e risoluzione dei simboli C/C++
 * 3) ricostruzione dell'indice delle formule con espressioni espanse
 * 
 * @param state - Stato corrente dell'estensione
 * @param files - Lista dei file da analizzare
 * @param yamlPath - Percorso del file YAML
 * @param loadedYaml - Contenuto YAML parsato
 * @param stackStats - Statistiche per la risoluzione simboli
 */
async function runYamlAnalysis(
  state: CalcDocsState,
  files: string[],
  yamlPath: string,
  loadedYaml: LoadedYaml,
  stackStats: SymbolResolutionStats
): Promise<void> {
  state.lastYamlPath = yamlPath;
  state.lastYamlRaw = loadedYaml.rawText;

  // Estrai le entry YAML e inizializza i valori dei simboli
  const yamlNodes = getYamlNodeEntries(loadedYaml.parsed);
  seedSymbolValuesFromYaml(state, yamlNodes);

  // Raccogli e applica i simboli C/C++
  const cppSymbols = await collectDefinesAndConsts(files, state.workspaceRoot);
  applyCppSymbols(state, cppSymbols, {
    resetSymbolValues: false,
    applyConstsBeforeResolve: true,
    requireFiniteResolvedValues: false,
    symbolResolutionStats: stackStats,
  });

  // Carica le tabelle CSV adiacenti
  const csvTables = await loadAdjacentCsvTables(yamlPath);
  
  // Ricostruisci l'indice delle formule con espressioni espanse e valori calcolati
  rebuildFormulaIndex(
    state,
    yamlNodes,
    loadedYaml.rawText,
    yamlPath,
    state.allDefines,
    state.functionDefines,
    {
      csvTables,
    },
    stackStats
  );

  state.output.info(
    localize("output.analysisComplete", state.formulaIndex.size)
  );
}

/**
 * Filtra l'oggetto YAML radice fino ai soli nodi oggetto di primo livello.
 * Esempio: ignora le chiavi scalari come "version: 1" e tiene i blocchi come "PRESSURE_DROP:".
 * 
 * @param yamlRoot - Oggetto YAML parsato
 * @returns Array di coppie [chiave, oggetto] per i nodi di primo livello
 */
function getYamlNodeEntries(yamlRoot: Record<string, unknown>): YamlNodeEntries {
  const entries: YamlNodeEntries = [];

  for (const [key, value] of Object.entries(yamlRoot)) {
    // Salta valori non-oggetto o array
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    entries.push([key, value as Record<string, unknown>]);
  }

  return entries;
}

/**
 * Inizializza i valori simbolici dai campi "value" YAML.
 * Esempio: { PRESSURE_DROP: { value: 25 } } -> symbolValues.set("PRESSURE_DROP", 25)
 * 
 * @param state - Stato corrente dell'estensione
 * @param yamlNodes - Entry YAML da processare
 */
function seedSymbolValuesFromYaml(
  state: CalcDocsState,
  yamlNodes: YamlNodeEntries
): void {
  state.symbolValues.clear();

  for (const [key, node] of yamlNodes) {
    if (!("value" in node)) {
      continue;
    }

    const numericValue = Number(node.value);
    if (Number.isFinite(numericValue)) {
      state.symbolValues.set(key, numericValue);
    }
  }
}

/**
 * Merge delle definizioni #define e costanti C/C++ nello stato e risoluzione dei simboli derivati.
 * Le opzioni controllano l'ordine di merge in base alla modalità di analisi corrente.
 * 
 * @param state - Stato corrente dell'estensione
 * @param cppSymbols - Simboli C/C++ raccolti dal parser
 * @param options - Opzioni che controllano l'ordine di merge
 */
function applyCppSymbols(
  state: CalcDocsState,
  cppSymbols: CollectedCppSymbols,
  options: {
    resetSymbolValues: boolean;
    applyConstsBeforeResolve: boolean;
    requireFiniteResolvedValues: boolean;
    symbolResolutionStats: SymbolResolutionStats;
  }
): void {
  // Pulisci tutte le strutture dati
  state.allDefines.clear();
  state.defineConditions.clear();
  state.functionDefines.clear();
  state.symbolDefs.clear();
  state.symbolConditionalDefs.clear();
  state.symbolAmbiguityRoots.clear();

  if (options.resetSymbolValues) {
    state.symbolValues.clear();
  }

  // Processa le definizioni #define
  for (const [name, expr] of cppSymbols.defines) {
    state.allDefines.set(name, expr);
    state.defineConditions.set(
      name,
      cppSymbols.defineConditions.get(name) ?? "always"
    );

    // Prova a valutare immediatamente il valore numerico
    try {
      const numericValue = safeEval(expr);
      state.symbolValues.set(name, numericValue);
    } catch {
      // Mantieni le definizioni non risolte per espansione ricorsiva
    }
  }

  // Processa le macro funzione
  for (const [name, definition] of cppSymbols.functionDefines) {
    state.functionDefines.set(name, {
      params: [...definition.params],
      body: definition.body,
    });
  }

  // Applica le costanti prima o dopo la risoluzione in base alle opzioni
  if (options.applyConstsBeforeResolve) {
    mergeConstValues(state, cppSymbols.consts);
  }

  // Risolvi le definizioni rimanenti ricorsivamente
  resolveRemainingDefines(
    state,
    options.requireFiniteResolvedValues,
    options.symbolResolutionStats
  );

  if (!options.applyConstsBeforeResolve) {
    mergeConstValues(state, cppSymbols.consts);
  }

  // Aggiungi le posizioni delle definizioni
  for (const [name, location] of cppSymbols.locations) {
    state.symbolDefs.set(name, location);
  }

  // Aggiorna le informazioni sulle definizioni condizionali
  updateConditionalDefinitionInfo(state, cppSymbols.defineVariants);
  // Rimuovi i simboli ambigui dallo stato di valutazione
  removeAmbiguousSymbolsFromEvaluationState(state);
}

/**
 * Copia i valori numerici diretti estratti dalle dichiarazioni C/C++ in symbolValues.
 * 
 * @param state - Stato corrente dell'estensione
 * @param consts - Mappa nome -> valore delle costanti
 */
function mergeConstValues(
  state: CalcDocsState,
  consts: Map<string, number>
): void {
  for (const [name, value] of consts) {
    state.symbolValues.set(name, value);
  }
}

/**
 * Tentativo di valutazione ricorsiva per i simboli #define non ancora risolti.
 * Esempio: se A=10 e B=(A*2), questo riempie B=20.
 * 
 * @param state - Stato corrente dell'estensione
 * @param requireFiniteResolvedValues - Se true, richiede valori finiti
 * @param stackStats - Statistiche per il monitoraggio della ricorsione
 */
function resolveRemainingDefines(
  state: CalcDocsState,
  requireFiniteResolvedValues: boolean,
  stackStats: SymbolResolutionStats
): void {
  for (const name of state.allDefines.keys()) {
    // Salta se già risolto
    if (state.symbolValues.has(name)) {
      continue;
    }

    // Prova a risolvere il simbolo
    const resolvedValue = resolveSymbol(
      name,
      state.allDefines,
      state.functionDefines,
      new Map<string, number>(),
      state.symbolValues,
      {},
      stackStats,
      new Set<string>(),
      state.defineConditions
    );

    const isResolvedNumber =
      typeof resolvedValue === "number" &&
      (!requireFiniteResolvedValues || Number.isFinite(resolvedValue));

    if (isResolvedNumber) {
      state.symbolValues.set(name, resolvedValue);
    }
  }
}

/**
 * Persiste ogni definizione condizionale parsata e propaga l'ambiguità ai simboli dipendenti.
 * Esempio: se N ha 2 varianti #define e M usa N, sia N che M vengono marcati come ambigui.
 * 
 * @param state - Stato corrente dell'estensione
 * @param defineVariants - Varianti delle definizioni raccolte dal parser
 */
function updateConditionalDefinitionInfo(
  state: CalcDocsState,
  defineVariants: CollectedCppSymbols["defineVariants"]
): void {
  // Salva tutte le varianti condizionali
  for (const [name, variants] of defineVariants) {
    state.symbolConditionalDefs.set(
      name,
      variants.map((variant) => ({ ...variant }))
    );
  }

  // Trova le radici di ambiguità (simboli con più varianti)
  const ambiguousRoots = Array.from(defineVariants.entries())
    .filter(([, variants]) => variants.length > 1)
    .map(([name]) => name);

  if (ambiguousRoots.length === 0) {
    return;
  }

  // Costruisci le dipendenze inverse per propagare l'ambiguità
  const reverseDependencies = buildReverseDefineDependencies(defineVariants);
  const inheritedAmbiguities = new Map<string, Set<string>>();

  // Propaga l'ambiguità a tutti i simboli dipendenti
  for (const root of ambiguousRoots) {
    const rootSet = inheritedAmbiguities.get(root) ?? new Set<string>();
    rootSet.add(root);
    inheritedAmbiguities.set(root, rootSet);

    const visited = new Set<string>([root]);
    const queue = Array.from(reverseDependencies.get(root) ?? []);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);

      const currentSet = inheritedAmbiguities.get(current) ?? new Set<string>();
      currentSet.add(root);
      inheritedAmbiguities.set(current, currentSet);

      // Aggiungi i dipendenti alla coda
      for (const next of reverseDependencies.get(current) ?? []) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  // Salva le ambiguità ereditate
  for (const [name, roots] of inheritedAmbiguities) {
    state.symbolAmbiguityRoots.set(name, Array.from(roots).sort());
  }
}

/**
 * Mantiene i simboli ambigui disponibili per la navigazione, ma li esclude dalla valutazione numerica.
 * 
 * @param state - Stato corrente dell'estensione
 */
function removeAmbiguousSymbolsFromEvaluationState(state: CalcDocsState): void {
  for (const name of state.symbolAmbiguityRoots.keys()) {
    state.symbolValues.delete(name);
    state.allDefines.delete(name);
    state.defineConditions.delete(name);
    state.functionDefines.delete(name);
  }
}

/**
 * Costruisce una mappa di dipendenze inverse per le definizioni condizionali.
 * Mappa ogni simbolo all'insieme dei simboli che dipendono da esso.
 * 
 * @param defineVariants - Varianti delle definizioni
 * @returns Mappa delle dipendenze inverse
 */
function buildReverseDefineDependencies(
  defineVariants: CollectedCppSymbols["defineVariants"]
): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();

  for (const [name, variants] of defineVariants) {
    const dependencies = new Set<string>();

    // Estrai tutti i token usati in ogni variante
    for (const variant of variants) {
      for (const token of variant.expr.match(TOKEN_RX) ?? []) {
        if (token !== name) {
          dependencies.add(token);
        }
      }
    }

    // Registra ogni dipendenza
    for (const dependency of dependencies) {
      const dependents = reverse.get(dependency) ?? new Set<string>();
      dependents.add(name);
      reverse.set(dependency, dependents);
    }
  }

  return reverse;
}

/**
 * Ricostruisce le entry dell'indice delle formule arricchite con espressione espansa e valore calcolato.
 * Esempio: "RHO * V * V / 2" -> "1.2 * 10 * 10 / 2" -> 60.
 * 
 * @param state - Stato corrente dell'estensione
 * @param yamlNodes - Entry YAML da processare
 * @param yamlRaw - Testo raw del YAML
 * @param yamlPath - Percorso del file YAML
 * @param defines - Mappa delle definizioni
 * @param functionDefines - Mappa delle macro funzione
 * @param evalContext - Contesto di valutazione (CSV tables, etc.)
 * @param stackStats - Statistiche di risoluzione
 */
function rebuildFormulaIndex(
  state: CalcDocsState,
  yamlNodes: YamlNodeEntries,
  yamlRaw: string,
  yamlPath: string,
  defines: Map<string, string>,
  functionDefines: CalcDocsState["functionDefines"],
  evalContext: EvaluationContext,
  stackStats: SymbolResolutionStats
): void {
  state.formulaIndex.clear();

  for (const [key, node] of yamlNodes) {
    // Costruisci l'entry della formula dal nodo YAML
    const entry = buildFormulaEntry(
      key,
      node,
      yamlRaw,
      yamlPath,
      state.workspaceRoot
    );

    // Se c'è una formula, processa e calcola il valore
    if (entry.formula) {
      entry.labels = mergeEntryLabels(entry.formula, entry.labels);
      const ambiguousSymbols = getAmbiguousFormulaSymbols(entry.formula, state);
      
      // Processa solo se non ci sono simboli ambigui
      if (ambiguousSymbols.length === 0) {
        const resolvedMap = new Map<string, number>();
        const replaced = replaceTokens(entry.formula, state.symbolValues);
        const expanded = expandExpression(
          replaced,
          defines,
          functionDefines,
          resolvedMap,
          state.symbolValues,
          evalContext,
          stackStats,
          state.defineConditions
        );
        const expandedWithLookups = resolveInlineLookups(expanded, evalContext);

        entry.expanded = clampLen(expandedWithLookups);

        // Prova a calcolare il valore numerico
        try {
          entry.valueCalc = safeEval(expandedWithLookups, evalContext);
        } catch {
          // Lascia valueCalc come null quando l'espressione non è numerica
        }
      }
    }

    state.formulaIndex.set(key, entry);
  }
}

/**
 * Estrae i simboli ambigui da una formula.
 * Un simbolo è ambiguo se ha definizioni condizionali multiple o dipende da un simbolo ambiguo.
 * 
 * @param formula - Stringa della formula da analizzare
 * @param state - Stato corrente dell'estensione
 * @returns Array di nomi di simboli ambigui
 */
function getAmbiguousFormulaSymbols(
  formula: string,
  state: CalcDocsState
): string[] {
  const ambiguous = new Set<string>();

  for (const token of formula.match(TOKEN_RX) ?? []) {
    if (state.symbolAmbiguityRoots.has(token)) {
      ambiguous.add(token);
    }
  }

  return Array.from(ambiguous);
}

/**
 * Unisce le etichette esistenti con le etichette derivate dalla formula.
 * Aggiunge etichette come "table_lookup" o "complex_expression" se appropriato.
 * 
 * @param formula - Stringa della formula
 * @param existingLabels - Etichette già presenti
 * @returns Array di etichette unificate
 */
function mergeEntryLabels(
  formula: string,
  existingLabels: FormulaLabel[]
): FormulaLabel[] {
  const merged = new Set<FormulaLabel>(existingLabels);

  // Aggiungi etichetta table_lookup se la formula usa lookup
  if (TABLE_LOOKUP_RX.test(formula)) {
    merged.add("table_lookup");
  }

  // Aggiungi etichetta complex_expression se è un'espressione complessa
  if (isComplexFormulaExpression(formula)) {
    merged.add("complex_expression");
  }

  return Array.from(merged);
}

/**
 * Determina se un'espressione di formula è "complessa".
 * Complessa significa che contiene operatori e/o simboli risolvibili.
 * 
 * @param formula - Stringa della formula da analizzare
 * @returns True se l'espressione è considerata complessa
 */
function isComplexFormulaExpression(formula: string): boolean {
  // Usa lookup table -> complessa
  if (TABLE_LOOKUP_RX.test(formula)) {
    return true;
  }

  // Chiama funzioni -> complessa
  if (FUNC_CALL_RX.test(formula)) {
    return true;
  }

  // Controlla se ci sono almeno 2 operatori
  const operatorCount = formula.match(OPERATOR_COUNT_RX)?.length ?? 0;
  return operatorCount >= 2;
}

/**
 * Scrive l'espressione espansa ("dati") e il valore calcolato di nuovo nei blocchi YAML.
 * I campi esistenti vengono aggiornati, quelli mancanti vengono inseriti vicino al blocco formula.
 * 
 * Ordine di inserimento campi (priorità):
 * 1. dati (prima della formula)
 * 2. formula
 * 3. altri campi (step, unit, etc. - mantiene ordine esistente)
 * 4. value (ultimo)
 * 
 * @param state - Stato corrente dell'estensione
 * @param yamlPath - Percorso del file YAML da aggiornare
 * @param rawText - Testo raw originale del YAML
 */
export async function writeBackYaml(
  state: CalcDocsState,
  yamlPath: string,
  rawText: string
): Promise<void> {
  const lines = rawText.split(/\r?\n/);

  const valueRegex = /^\s*value\s*:/i;
  const datiRegex = /^\s*dati\s*:/i;
  const formulaRegex = /^\s*formula\s*:/i;

  // Processa le entry ordinate per linea originale per gestire correttamente gli offset
  const sortedEntries = Array.from(state.formulaIndex.values())
    .filter((entry) => entry._line != null)
    .sort((a, b) => (a._line ?? 0) - (b._line ?? 0));

  let lineOffset = 0;

  for (const entry of sortedEntries) {
    // Applica accumulato per otten l'offset lineere la posizione corrente
    const lineIndex = (entry._line ?? 0) + lineOffset;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      continue;
    }

    const keyLine = lines[lineIndex];
    const keyIndent = keyLine.match(/^\s*/)?.[0] ?? "";
    const fieldIndent = `${keyIndent}  `;

    let pointer = lineIndex + 1;
    let valueLineIndex = -1;
    let datiLineIndex = -1;

    // Trova le linee dei campi value e dati
    while (pointer < lines.length) {
      const currentLine = lines[pointer];
      const trimmed = currentLine.trim();
      const isEmpty = trimmed.length === 0;
      const isIndented = /^\s+/.test(currentLine);

      if (!isEmpty && !isIndented) {
        break;
      }

      if (valueRegex.test(currentLine)) {
        valueLineIndex = pointer;
      } else if (datiRegex.test(currentLine)) {
        datiLineIndex = pointer;
      }

      pointer += 1;
    }

    const blockStart = lineIndex + 1;
    const blockEnd = pointer;

    // Gestisci dati - dovrebbe essere prima della formula (posizione 2)
    if (entry.expanded) {
      const newDatiLine = `${fieldIndent}dati: ${entry.expanded}`;

      if (datiLineIndex >= 0) {
        lines[datiLineIndex] = newDatiLine;
      } else {
        // Trova la linea della formula per inserire prima
        let formulaLineIndex = -1;
        for (let i = blockStart; i < blockEnd; i += 1) {
          if (formulaRegex.test(lines[i])) {
            formulaLineIndex = i;
            break;
          }
        }
        // Inserisci alla posizione della formula o all'inizio del blocco
        const insertIndex = formulaLineIndex >= 0 ? formulaLineIndex : blockStart;
        lines.splice(insertIndex, 0, newDatiLine);
        lineOffset += 1;

        // Aggiusta tutti gli indici tracciati dato che abbiamo inserito una linea
        if (valueLineIndex >= 0 && valueLineIndex >= insertIndex) {
          valueLineIndex += 1;
        }
      }
    }

    // Gestisci value - dovrebbe essere alla FINE del blocco
    if (entry.valueCalc != null) {
      const newValueLine = `${fieldIndent}value: ${entry.valueCalc}`;

      if (valueLineIndex >= 0) {
        lines[valueLineIndex] = newValueLine;
      } else {
        // Inserisci alla FINE del blocco
        lines.splice(blockEnd - 1 + lineOffset, 0, newValueLine);
        lineOffset += 1;
      }
    }
  }

  const updatedText = lines.join("\n");

  // Nessun aggiornamento necessario se il testo non è cambiato
  if (updatedText === rawText) {
    state.output.detail(localize("output.noYamlUpdates", yamlPath));
    return;
  }

  // Scrivi il file aggiornato
  await fsp.writeFile(yamlPath, updatedText, "utf8");
  state.lastYamlRaw = updatedText;
  state.output.detail(localize("output.yamlUpdated", yamlPath));
}

