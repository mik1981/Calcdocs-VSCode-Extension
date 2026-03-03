import * as vscode from "vscode";

import { CalcDocsState } from "./state";

export type CalcDocsConfig = {
  scanInterval: number;
  ignoredDirs: string[];
  enableCppProviders: boolean;
};

/**
 * Reads extension settings from "calcdocs.*" and normalizes defaults.
 */
export function getConfig(): CalcDocsConfig {
  const cfg = vscode.workspace.getConfiguration("calcdocs");

  return {
    scanInterval: Number(cfg.get<number>("scanInterval", 0)),
    ignoredDirs: cfg.get<string[]>("ignoredDirs", []),
    enableCppProviders: cfg.get<boolean>("enableCppProviders", true),
  };
}

/**
 * Rebuilds ignored directory set inside shared state from current configuration.
 */
export function refreshIgnoredDirs(
  state: CalcDocsState,
  config: CalcDocsConfig = getConfig()
): void {
  state.ignoredDirs = new Set(config.ignoredDirs);
}

/**
 * Checks whether a URI path matches one of ignored directory rules.
 * Example:
 * - "build" ignores ".../build/..." and ".../build"
 * - "Debug*" ignores paths containing "/debug"
 */
export function isIgnoredUri(state: CalcDocsState, uri: vscode.Uri): boolean {
  const normalizedPath = uri.fsPath.replace(/\\/g, "/").toLowerCase();

  for (const rawEntry of state.ignoredDirs) {
    const entry = rawEntry.replace(/\\/g, "/").toLowerCase();

    if (entry.endsWith("*")) {
      if (normalizedPath.includes("/" + entry.slice(0, -1))) {
        return true;
      }
      continue;
    }

    if (
      normalizedPath.includes("/" + entry + "/") ||
      normalizedPath.endsWith("/" + entry)
    ) {
      return true;
    }
  }

  return false;
}
