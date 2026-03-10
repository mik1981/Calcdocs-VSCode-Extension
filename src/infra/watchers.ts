import * as vscode from "vscode";

import { CalcDocsConfig, isIgnoredUri } from "../core/config";
import { CalcDocsState } from "../core/state";

/**
 * Centralizes file watchers, debounced analysis triggers, and periodic rescans.
 */
export class AnalysisScheduler implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly state: CalcDocsState,
    private readonly runAnalysis: () => Promise<void>
  ) {}

  /**
   * Debounces analysis execution to avoid storms while files are being edited.
   */
  schedule(delayMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      if (!this.state.enabled) {
        return;
      }

      void this.runAnalysis();
    }, delayMs);
  }

  /**
   * Applies latest extension configuration to watchers and periodic timer.
   */
  applyConfiguration(
    context: vscode.ExtensionContext,
    config: CalcDocsConfig
  ): void {
    this.registerWatchers(
      context,
      config.enableCppProviders,
      config.scanInterval,
      config.enabled
    );
    this.setupPeriodicScan(config.scanInterval, config.enabled);
  }

  /**
   * Disposes timers and watchers owned by this scheduler.
   */
  dispose(): void {
    this.disposeWatchers();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Recreates file watchers according to provider mode and scan interval.
   */
  private registerWatchers(
    context: vscode.ExtensionContext,
    enableCppProviders: boolean,
    scanInterval: number,
    enabled: boolean
  ): void {
    this.disposeWatchers();

    if (!enabled || scanInterval === 0) {
      return;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      return;
    }

    const extensionPattern = enableCppProviders
      ? "**/*.{yaml,yml,c,cpp,h,hpp,cc,hh}"
      : "**/*.{yaml,yml}";

    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(folder, extensionPattern);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      const onFileEvent = (uri: vscode.Uri): void => {
        if (isIgnoredUri(this.state, uri)) {
          return;
        }

        this.schedule(250);
      };

      watcher.onDidCreate(onFileEvent);
      watcher.onDidChange(onFileEvent);
      watcher.onDidDelete(onFileEvent);

      this.watchers.push(watcher);
      context.subscriptions.push(watcher);
    }
  }

  /**
   * Configures periodic analysis loop (seconds -> ms).
   */
  private setupPeriodicScan(scanInterval: number, enabled: boolean): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }

    if (!enabled || scanInterval === 0) {
      this.disposeWatchers();
      return;
    }

    const intervalMs = scanInterval * 1000;
    if (intervalMs <= 0) {
      return;
    }

    this.periodicTimer = setInterval(() => {
      this.schedule(0);
    }, intervalMs);
  }

  /**
   * Safely disposes all active file system watchers.
   */
  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }

    this.watchers = [];
  }
}