import * as vscode from "vscode";

import { registerCommands } from "./commands/commands";
import { runAnalysis } from "./core/analysis";
import { getConfig } from "./core/config";
import { clearComputedState, createCalcDocsState } from "./core/state";
import { createColoredOutput } from "./utils/output";
import { localize } from "./utils/localize";
import { ExtensionResourceMonitor, type ExtensionResourceSnapshot } from "./infra/resourceMonitor";
import { AnalysisScheduler } from "./infra/watchers";
import {
  CppValueCodeLensProvider,
  registerCppCodeLensProvider,
} from "./providers/codeLensProvider";
import { registerDefinitionProviders } from "./providers/definitionProvider";
import { registerCppHoverProvider } from "./providers/hoverProvider";
import {
  createRuntimeStatusBar,
  createStatusBar,
  updateRuntimeStatusBar,
  updateStatusBar,
  updateStatusBarVisibility,
} from "./ui/statusBar";
import { test_lang  } from "./utils/localize";

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

  // Crea gli elementi della status bar
  statusBar = createStatusBar(context);
  runtimeStatusBar = createRuntimeStatusBar(context);

  // Crea il provider per i CodeLens (valori delle formule C/C++)
  const codeLensProvider = new CppValueCodeLensProvider(state);

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
      refreshFormulaStatus();
      refreshRuntimeStatus();
      codeLensProvider.refresh();
      return;
    }

    // Esegui l'analisi del workspace
    await runAnalysis(state);

    // Aggiorna tutti i componenti UI
    refreshFormulaStatus();
    refreshRuntimeStatus();
    codeLensProvider.refresh();
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
  registerCppCodeLensProvider(context, codeLensProvider);

  // Aggiorna i CodeLens quando un documento viene modificato
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      if (!state.enabled) {
        return;
      }

      codeLensProvider.refresh();
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

      // Log del cambiamento di stato enabled
      if (previousConfig.enabled !== nextConfig.enabled) {
        coloredOutput!.info(`[config] enabled=${nextConfig.enabled}`);
      }

      // Aggiorna la configurazione dello scheduler e del monitor risorse
      scheduler?.applyConfiguration(context, nextConfig);
      resourceMonitor?.applyConfiguration({
        mode: nextConfig.resourceStatusMode,
        cpuThreshold: nextConfig.resourceCpuThreshold,
      });
      refreshRuntimeStatus();

      // Determina se è necessario rieseguire l'analisi
      const analysisRelevantChange =
        event.affectsConfiguration("calcdocs.enabled") ||
        event.affectsConfiguration("calcdocs.scanInterval") ||
        event.affectsConfiguration("calcdocs.ignoredDirs") ||
        event.affectsConfiguration("calcdocs.enableCppProviders");

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

