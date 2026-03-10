import * as vscode from "vscode";
import type { AnalysisStackUsage, YamlParseErrorInfo } from "../core/state";
import { localize } from "../utils/localize";

/**
 * Colori della status bar per i diversi stati dell'estensione.
 * Utilizza i colori nativi di VSCode per compatibilità con tema chiaro/scuro.
 */
const StatusBarColors = {
  /** Colore per indicare che CalcDocs è attivo e funzionante correttamente */
  enabled: new vscode.ThemeColor("statusBarItem.prominentForeground"),
  /** Colore per indicare stati di warning: disabilitato, CPU elevata, stack usage degradato */
  warning: new vscode.ThemeColor("statusBarItem.warningForeground"),
  /** Colore per errori (es. errore di parsing YAML) */
  error: new vscode.ThemeColor("errorForeground"),
  /** Colore di default (usa il colore standard della status bar) */
  default: undefined,
} as const;

/**
 * Crea l'elemento della status bar di CalcDocs e associa l'azione di click al refresh manuale.
 * La status bar mostra il numero di formule indicizzate nell workspace.
 * 
 * @param context - Contesto dell'estensione VSCode
 * @returns Elemento della status bar configurato
 */
export function createStatusBar(
  context: vscode.ExtensionContext
): vscode.StatusBarItem {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

  statusBar.text = localize("statusBar.initializing");
  statusBar.command = "calcdocs.forceRefresh";

  context.subscriptions.push(statusBar);

  return statusBar;
}

/**
 * Crea l'elemento della status bar runtime che mostra lo stato di abilitazione
 * dell'estensione e l'utilizzo delle risorse (CPU e RAM).
 * Clickando sull'icona si attiva/disattiva l'estensione.
 * 
 * @param context - Contesto dell'estensione VSCode
 * @returns Elemento della status bar runtime configurato
 */
export function createRuntimeStatusBar(
  context: vscode.ExtensionContext
): vscode.StatusBarItem {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );

  statusBar.command = "calcdocs.toggleEnabled";
  statusBar.text = "$(pulse) " + localize("statusBar.runtimeInitializing");
  statusBar.tooltip = localize("statusBar.clickToDisable");

  context.subscriptions.push(statusBar);

  return statusBar;
}

/**
 * Aggiorna il contatore delle formule indicizzate mostrato nella status bar.
 * Cambia icona e colore in base allo stato di stack usage e alla presenza di errori YAML.
 * 
 * @param statusBar - Elemento della status bar da aggiornare
 * @param formulaCount - Numero di formule indicizzate
 * @param stackUsage - Statistiche sull'utilizzo dello stack dalla última analisi
 * @param yamlParseError - Errore di parsing YAML (null se tutto ok)
 */
export function updateStatusBar(
  statusBar: vscode.StatusBarItem,
  formulaCount: number,
  stackUsage: AnalysisStackUsage,
  yamlParseError: YamlParseErrorInfo | null
): void {
  // Se c'è un errore di parsing YAML, mostra lo stato di errore
  if (yamlParseError) {
    const locationLabel =
      yamlParseError.line != null && yamlParseError.column != null
        ? ` (line ${yamlParseError.line}, col ${yamlParseError.column})`
        : "";

    statusBar.text = `$(error) ` + localize("statusBar.yamlError");
    statusBar.tooltip = localize("statusBar.yamlErrorTooltip", yamlParseError.yamlPath, locationLabel);
    statusBar.color = StatusBarColors.error;
    statusBar.command = "calcdocs.showOutput";
    return;
  }

  // Usa icona di warning se lo stack usage è degradato, altrimenti usa refresh
  const icon = stackUsage.degraded ? "$(warning)" : "$(refresh)";

  statusBar.text = `${icon} ` + localize("statusBar.formulaCount", formulaCount);
  statusBar.tooltip = localize("statusBar.updatesIndexed");
  statusBar.color = stackUsage.degraded
    ? StatusBarColors.warning
    : StatusBarColors.default;
  statusBar.command = "calcdocs.forceRefresh";
}

/**
 * Mostra o nasconde la status bar in base alla presenza del file formulas YAML
 * e allo stato di abilitazione dell'estensione.
 * 
 * @param statusBar - Elemento della status bar da mostrare/nascondere
 * @param hasFormulasFile - True se esiste un file formulas.yaml nella workspace
 * @param enabled - True se l'estensione è abilitata nelle impostazioni
 */
export function updateStatusBarVisibility(
  statusBar: vscode.StatusBarItem,
  hasFormulasFile: boolean,
  enabled: boolean
): void {
  if (hasFormulasFile && enabled) {
    statusBar.show();
    return;
  }

  statusBar.hide();
}

/**
 * Aggiorna la status bar runtime con lo stato corrente di abilitazione
 * e le statistiche di utilizzo delle risorse (CPU e RAM).
 * Cambia colore in base allo stato: enabled=verde, disabled/cpu elevata=arancione.
 * 
 * @param statusBar - Elemento della status bar runtime da aggiornare
 * @param enabled - True se l'estensione è attualmente abilitata
 * @param cpuPercent - Utilizzo CPU corrente in percentuale
 * @param memoryRssMb - Memoria RSS del processo in MB
 * @param cpuThreshold - Soglia CPU per mostrare warning
 * @param stackUsage - Statistiche sull'utilizzo dello stack
 */
export function updateRuntimeStatusBar(
  statusBar: vscode.StatusBarItem,
  enabled: boolean,
  cpuPercent: number,
  memoryRssMb: number,
  cpuThreshold: number,
  stackUsage: AnalysisStackUsage
): void {
  // Se l'estensione è disabilitata, mostra stato OFF
  if (!enabled) {
    statusBar.text = "$(circle-slash) " + localize("statusBar.runtimeOff");
    statusBar.tooltip = localize("statusBar.clickToEnable");
    statusBar.color = StatusBarColors.warning;
    return;
  }

  const cpuLabel = cpuPercent.toFixed(1);
  const memoryLabel = memoryRssMb.toFixed(0);
  const stackLabel =
    stackUsage.degraded
      ? localize("statusBar.stackUsage", stackUsage.usedDepth, stackUsage.depthLimit)
      : "";

  statusBar.text = "$(pulse) " + localize("statusBar.runtimeOn");
  
  // Tooltip diverso in base allo stato di degradazione
  statusBar.tooltip = 
    stackUsage.degraded
      ? localize("statusBar.enabledDegradedDetails", cpuLabel, memoryLabel, stackLabel, cpuThreshold, stackUsage.usedDepth, stackUsage.depthLimit, stackUsage.cycleCount, stackUsage.prunedCount)
      : localize("statusBar.enabledDetails", cpuLabel, memoryLabel, stackLabel, cpuThreshold);
  
  // Colore: warning se CPU elevata o stack degradato, altrimenti enabled
  statusBar.color =
    cpuPercent >= cpuThreshold || stackUsage.degraded
      ? StatusBarColors.warning
      : StatusBarColors.enabled;
}

