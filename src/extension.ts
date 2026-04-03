import * as vscode from "vscode";

import { registerCommands } from "./commands/commands";
import { runAnalysis, runActiveCppFileAnalysis } from "./core/analysis";
import {
  clearInlineCalcDiagnostics,
  refreshInlineCalcDiagnosticsForDocument,
  refreshInlineCalcDiagnosticsForVisibleEditors,
} from "./core/inlineCalcDiagnostics";
import { getConfig } from "./core/config";
import { clearComputedState, createCalcDocsState, clearDiagnostics } from "./core/state";

import { createColoredOutput } from "./utils/output";
import { localize } from "./utils/localize";
import { ExtensionResourceMonitor, type ExtensionResourceSnapshot } from "./infra/resourceMonitor";
import { AnalysisScheduler } from "./infra/watchers";
import {
  CppValueCodeLensProvider,
  registerCppCodeLensProvider,
} from "./providers/codeLensProvider";
import {
  InlineCalcCodeLensProvider,
  registerInlineCalcCodeLensProvider,
} from "./providers/inlineCalcCodeLensProvider";
import { registerInlineCalcHoverProvider } from "./providers/inlineCalcHoverProvider";
import { registerYamlHoverProvider } from "./providers/yamlHoverProvider";
import { registerDefinitionProviders } from "./providers/definitionProvider";
import { registerCppHoverProvider } from "./providers/hoverProvider";
import { InlineCalcResultsViewProvider } from "./ui/inlineCalcResultsView";
import {
  createRuntimeStatusBar,
  createStatusBar,
  updateRuntimeStatusBar,
  updateStatusBar,
  updateStatusBarVisibility,
} from "./ui/statusBar";

function isCppFileEditor(
  editor: vscode.TextEditor | undefined
): editor is vscode.TextEditor {
  if (!editor) {
    return false;
  }

  const languageId = editor.document.languageId;
  if (languageId !== "c" && languageId !== "cpp") {
    return false;
  }

  return editor.document.uri.scheme === "file";
}

/**
 * Canale di output dell'estensione per messaggi di log e diagnostica.
 * Utilizzato per scrivere messaggi nella panel "CalcDocs" di VSCode.
 */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Wrapper ColoredOutput per supportare i colori nell'output.
 */
let coloredOutput: ReturnType<typeof createColoredOutput> | undefined;

/**
 * Pianificatore per l'analisi automatica del workspace.
 * Gestisce i watcher sui file e le esecuzioni periodiche/differite dell'analisi.
 */
let scheduler: AnalysisScheduler | undefined;

/**
 * Elemento della status bar che mostra il numero di formule indicizzate.
 * Posizionato a sinistra nella barra di stato di VSCode.
 */
let statusBar: vscode.StatusBarItem | undefined;

/**
 * Elemento della status bar che mostra lo stato runtime dell'estensione
 * (abilitata/disabilitata) e le statistiche di utilizzo risorse.
 */
let runtimeStatusBar: vscode.StatusBarItem | undefined;

/**
 * Monitor per le risorse di sistema (CPU e RAM) utilizzate dall'estensione.
 * Raccoglie periodicamente statistiche sull'utilizzo della CPU e della memoria.
 */
let resourceMonitor: ExtensionResourceMonitor | undefined;

/**
 * Punto di ingresso principale dell'estensione VSCode.
 * Inizializza lo stato, i provider, i comandi, lo scheduler e la status bar.
 * 
 * @param context - Contesto dell'estensione VSCode contenente subscriptions e configurazione
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Crea il canale di output per i messaggi di log
  outputChannel = vscode.window.createOutputChannel("CalcDocs");
  context.subscriptions.push(outputChannel);
  // test_lang(context, outputChannel);
  
  // Crea il wrapper ColoredOutput per supportare i colori
  coloredOutput = createColoredOutput(outputChannel);
  coloredOutput.info(localize("output.activate"));

  // Ottiene la cartella root del workspace aperto
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    coloredOutput.error(localize("output.noWorkspace"));
    return;
  }

  // Carica la configurazione dell'estensione
  let config = getConfig();

  // Crea lo stato iniziale dell'estensione per il workspace
  const state = createCalcDocsState(workspaceRoot, coloredOutput);
  state.enabled = config.enabled;
  state.inlineCalcEnableCodeLens = config.inlineCalcEnableCodeLens;
  state.inlineCalcEnableHover = config.inlineCalcEnableHover;
  state.inlineCalcDiagnosticsLevel = config.inlineCalcDiagnosticsLevel;

  // Create diagnostics collection for YAML errors/discrepancies
  state.diagnostics = vscode.languages.createDiagnosticCollection("calcdocs");
  context.subscriptions.push(state.diagnostics);
  state.inlineCalcDiagnostics = vscode.languages.createDiagnosticCollection(
    "calcdocs-inline-calc"
  );
  context.subscriptions.push(state.inlineCalcDiagnostics);


  state.output.setLevel(config.internalDebugMode);

  // Crea gli elementi della status bar
  statusBar = createStatusBar(context);
  runtimeStatusBar = createRuntimeStatusBar(context);

  // Crea il provider per i CodeLens (valori delle formule C/C++)
  const codeLensProvider = new CppValueCodeLensProvider(state);
  const inlineCalcCodeLensProvider = new InlineCalcCodeLensProvider(state);
  const inlineCalcResultsViewProvider = new InlineCalcResultsViewProvider(state);

  context.subscriptions.push(
    vscode.window.createTreeView("calcdocs.inlineCalcResults", {
      treeDataProvider: inlineCalcResultsViewProvider,
      showCollapseAll: false,
    })
  );

  inlineCalcResultsViewProvider.setActiveEditor(vscode.window.activeTextEditor);

  // Snapshot iniziale delle risorse di sistema
  let lastResourceSnapshot: ExtensionResourceSnapshot = {
    cpuPercent: 0,
    memoryRssMb: process.memoryUsage().rss / (1024 * 1024),
    shouldShowStatus: true,
  };

  /**
   * Aggiorna lo stato della status bar delle formule.
   * Callback chiamato dopo ogni analisi o cambiamento di configurazione.
   */
  const refreshFormulaStatus = (): void => {
    if (!statusBar) {
      return;
    }

    updateStatusBar(
      statusBar,
      state.formulaIndex.size,
      state.lastAnalysisStackUsage,
      state.lastYamlParseError
    );
    updateStatusBarVisibility(statusBar, state.hasFormulasFile, state.enabled);
  };

  /**
   * Aggiorna lo stato della status bar runtime (abilitazione e risorse).
   * Callback chiamato quando cambiano le risorse di sistema o lo stato di abilitazione.
   */
  const refreshRuntimeStatus = (): void => {
    if (!runtimeStatusBar) {
      return;
    }

    updateRuntimeStatusBar(
      runtimeStatusBar,
      state.enabled,
      lastResourceSnapshot.cpuPercent,
      lastResourceSnapshot.memoryRssMb,
      config.resourceCpuThreshold,
      state.lastAnalysisStackUsage
    );

    const shouldShow = !state.enabled || lastResourceSnapshot.shouldShowStatus;
    if (shouldShow) {
      runtimeStatusBar.show();
      return;
    }

    runtimeStatusBar.hide();
  };

  /**
   * Esegue l'analisi completa del workspace e sincronizza tutti i componenti UI
   * che dipendono dallo stato corrente.
   * Esempio: dopo un cambiamento nel file YAML, aggiorna l'indice delle formule,
   * la status bar e i CodeLens.
   */
  const runAnalysisAndRefreshUi = async (): Promise<void> => {
    // Se l'estensione è disabilitata, pulisci lo stato e ferma i provider
    if (!state.enabled) {
      clearComputedState(state);
      clearDiagnostics(state);
      clearInlineCalcDiagnostics(state);
      refreshFormulaStatus();
      refreshRuntimeStatus();
      codeLensProvider.refresh();
      inlineCalcCodeLensProvider.refresh();
      inlineCalcResultsViewProvider.refresh();
      return;
    }

    // Esegui l'analisi del workspace
    await runAnalysis(state);

    const activeEditor = vscode.window.activeTextEditor;
    if (isCppFileEditor(activeEditor)) {
      await runActiveCppFileAnalysis(state, activeEditor.document.uri.fsPath);
    }

    // Aggiorna tutti i componenti UI
    refreshFormulaStatus();
    refreshRuntimeStatus();
    codeLensProvider.refresh();
    inlineCalcCodeLensProvider.refresh();
    inlineCalcResultsViewProvider.refresh();
    refreshInlineCalcDiagnosticsForVisibleEditors(state);
  };

  const runActiveCppAnalysisAndRefreshUi = async (
    editor: vscode.TextEditor | undefined
  ): Promise<void> => {
    if (!state.enabled || !isCppFileEditor(editor)) {
      return;
    }

    await runActiveCppFileAnalysis(state, editor.document.uri.fsPath);
    refreshFormulaStatus();
    refreshRuntimeStatus();
    codeLensProvider.refresh();
    inlineCalcCodeLensProvider.refresh();
    inlineCalcResultsViewProvider.refresh();
    refreshInlineCalcDiagnosticsForVisibleEditors(state);
  };


  // Inizializza il monitor delle risorse di sistema
  resourceMonitor = new ExtensionResourceMonitor(
    (snapshot) => {
      lastResourceSnapshot = snapshot;
      refreshRuntimeStatus();
    },
    {
      mode: config.resourceStatusMode,
      cpuThreshold: config.resourceCpuThreshold,
    }
  );
  resourceMonitor.start();
  context.subscriptions.push(resourceMonitor);

  // Esegue l'analisi iniziale al caricamento dell'estensione
  await runAnalysisAndRefreshUi();

  // Registra i provider per hover, definition e CodeLens
  registerDefinitionProviders(context, state, config.enableCppProviders);
  registerCppHoverProvider(context, state, config.enableCppProviders);
  registerInlineCalcHoverProvider(context, state);
  registerYamlHoverProvider(context, state);
  registerCppCodeLensProvider(context, codeLensProvider);
  registerInlineCalcCodeLensProvider(context, inlineCalcCodeLensProvider);

  // Aggiorna i CodeLens quando un documento viene modificato
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!state.enabled) {
        return;
      }

      codeLensProvider.refresh();
      inlineCalcCodeLensProvider.refresh();
      inlineCalcResultsViewProvider.notifyDocumentChanged(event.document);
      refreshInlineCalcDiagnosticsForDocument(event.document, state);

      const isYamlDocument =
        (event.document.languageId === "yaml" || event.document.languageId === "yml") &&
        (event.document.uri.scheme === "file" || event.document.uri.scheme === "untitled");
      if (isYamlDocument) {
        scheduler?.schedule(200);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      inlineCalcResultsViewProvider.setActiveEditor(editor);
      inlineCalcCodeLensProvider.refresh();
      if (editor) {
        refreshInlineCalcDiagnosticsForDocument(editor.document, state);
      }
      void runActiveCppAnalysisAndRefreshUi(editor);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }

      if (activeEditor.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      inlineCalcResultsViewProvider.notifyDocumentChanged(document);
      inlineCalcCodeLensProvider.refresh();
      refreshInlineCalcDiagnosticsForDocument(document, state);
      void runActiveCppAnalysisAndRefreshUi(activeEditor);
    })
  );

  // Inizializza lo scheduler per l'analisi automatica
  scheduler = new AnalysisScheduler(state, runAnalysisAndRefreshUi);
  scheduler.applyConfiguration(context, config);
  context.subscriptions.push(scheduler);

  // Registra i comandi dell'estensione (forceRefresh, toggleEnabled, etc.)
  registerCommands({
    context,
    state,
    scheduler,
    runAnalysisAndRefreshUi,
  });

  // Gestisce i cambi di configurazione dell'estensione
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      // Verifica se il cambiamento riguarda CalcDocs
      if (!event.affectsConfiguration("calcdocs")) {
        return;
      }

      const previousConfig = config;
      const nextConfig = getConfig();
      config = nextConfig;
      state.enabled = nextConfig.enabled;
      state.inlineCalcEnableCodeLens = nextConfig.inlineCalcEnableCodeLens;
      state.inlineCalcEnableHover = nextConfig.inlineCalcEnableHover;
      state.inlineCalcDiagnosticsLevel = nextConfig.inlineCalcDiagnosticsLevel;

      // Log del cambiamento di stato enabled
      if (previousConfig.enabled !== nextConfig.enabled) {
        coloredOutput!.info(`[config] enabled=${nextConfig.enabled}`);
      }

      // Clear diagnostics if disabled
      if (!state.enabled) {
        clearDiagnostics(state);
        clearInlineCalcDiagnostics(state);
      }


      // Aggiorna la configurazione dello scheduler e del monitor risorse
      scheduler?.applyConfiguration(context, nextConfig);
      resourceMonitor?.applyConfiguration({
        mode: nextConfig.resourceStatusMode,
        cpuThreshold: nextConfig.resourceCpuThreshold,
      });
      refreshRuntimeStatus();
      inlineCalcCodeLensProvider.refresh();
      inlineCalcResultsViewProvider.refresh();
      refreshInlineCalcDiagnosticsForVisibleEditors(state);

      // Determina se è necessario rieseguire l'analisi
      const analysisRelevantChange =
        event.affectsConfiguration("calcdocs.enabled") ||
        event.affectsConfiguration("calcdocs.scanInterval") ||
        event.affectsConfiguration("calcdocs.ignoredDirs") ||
        event.affectsConfiguration("calcdocs.enableCppProviders") ||
        event.affectsConfiguration("calcdocs.cppCacheMaxEntries");

      if (analysisRelevantChange) {
        void runAnalysisAndRefreshUi();
      }
    })
  );
}

/**
 * Funzione di chiusura dell'estensione.
 * Rilascia tutti i timer, watcher, canale di output e risorse della status bar.
 */
export async function deactivate(): Promise<void> {
  // Ferma lo scheduler e related timers
  scheduler?.dispose();

  // Chiude il canale di output
  if (outputChannel && coloredOutput) {
    coloredOutput.info(localize("output.deactivate"));
    outputChannel.dispose();
  }

  // Rilascia le risorse del monitor e della status bar
  resourceMonitor?.dispose();
  statusBar?.dispose();
  runtimeStatusBar?.dispose();
}

