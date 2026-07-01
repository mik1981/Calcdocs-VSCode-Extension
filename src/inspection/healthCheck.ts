import * as vscode from "vscode";

import type { CalcDocsState } from "../core/state";
import type { FormulaEntry } from "../types/FormulaEntry";
import {
  documentMatchesPath,
  formulaEntryMatchesDocument,
  formatValue,
  getFormulaEntriesForDocument,
} from "./explainMode";

export type LocalHealthSeverity = "error" | "warning" | "info";

export type LocalHealthIssue = {
  severity: LocalHealthSeverity;
  category: "missing-symbol" | "invalid-value" | "unit-mismatch" | "diagnostic";
  formulaId?: string;
  line?: number;
  message: string;
};

export type LocalHealthReport = {
  activeDocument: string;
  checkedFormulaCount: number;
  issues: LocalHealthIssue[];
};

function issueSeverityFromText(message: string): LocalHealthSeverity {
  return /error|missing|unresolved|undefined|not defined|nan/i.test(message)
    ? "error"
    : /warning|mismatch/i.test(message)
      ? "warning"
      : "info";
}

function classifyMessage(message: string): LocalHealthIssue["category"] {
  if (/unit mismatch|dimension mismatch|output unit mismatch/i.test(message)) {
    return "unit-mismatch";
  }

  if (/missing|unresolved|undefined|not defined|unknown symbol/i.test(message)) {
    return "missing-symbol";
  }

  return "diagnostic";
}

function hasComputedValueProblem(entry: FormulaEntry): boolean {
  if (typeof entry.valueCalc === "number") {
    return !Number.isFinite(entry.valueCalc);
  }

  return entry.valueCalc === null && Boolean(entry.formula || entry.exprType === "expr");
}

function addEntryMessages(
  issues: LocalHealthIssue[],
  entry: FormulaEntry,
  messages: readonly string[],
  fallbackSeverity: LocalHealthSeverity
): void {
  for (const message of messages) {
    const category = classifyMessage(message);
    issues.push({
      severity:
        category === "unit-mismatch"
          ? "warning"
          : issueSeverityFromText(message) || fallbackSeverity,
      category,
      formulaId: entry.key,
      line: typeof entry._line === "number" ? entry._line + 1 : undefined,
      message,
    });
  }
}

function addFormulaIssues(
  issues: LocalHealthIssue[],
  entries: readonly FormulaEntry[]
): void {
  for (const entry of entries) {
    if (hasComputedValueProblem(entry)) {
      issues.push({
        severity: "error",
        category: "invalid-value",
        formulaId: entry.key,
        line: typeof entry._line === "number" ? entry._line + 1 : undefined,
        message: `Existing evaluation value is ${formatValue(entry.valueCalc, entry.unit)}.`,
      });
    }

    addEntryMessages(issues, entry, entry.evaluationErrors ?? [], "error");
    addEntryMessages(issues, entry, entry.evaluationWarnings ?? [], "warning");
  }
}

function addYamlDiagnostics(
  state: CalcDocsState,
  document: vscode.TextDocument,
  issues: LocalHealthIssue[]
): void {
  if (!documentMatchesPath(document, state.lastYamlPath)) {
    return;
  }

  for (const diagnostic of state.yamlDiagnostics) {
    issues.push({
      severity: diagnostic.severity,
      category: classifyMessage(diagnostic.message),
      formulaId: diagnostic.symbol,
      line: diagnostic.line + 1,
      message: diagnostic.message,
    });
  }
}

function dedupeIssues(issues: readonly LocalHealthIssue[]): LocalHealthIssue[] {
  const seen = new Set<string>();
  const result: LocalHealthIssue[] = [];

  for (const issue of issues) {
    const key = [
      issue.severity,
      issue.category,
      issue.formulaId ?? "",
      issue.line ?? "",
      issue.message,
    ].join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(issue);
  }

  return result;
}

export function buildLocalFormulaHealthCheck(
  state: CalcDocsState,
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
): LocalHealthReport | undefined {
  if (!editor) {
    return undefined;
  }

  // getFormulaEntriesForDocument gestisce internamente sia il file YAML
  // indicizzato globalmente sia eventuali altri formula*.yaml nel
  // workspace, tramite parsing locale del documento attivo.
  const entries = getFormulaEntriesForDocument(state, editor);
  const issues: LocalHealthIssue[] = [];

  addFormulaIssues(issues, entries);
  addYamlDiagnostics(state, editor.document, issues);

  const visibleIssues = dedupeIssues(issues).filter((issue) => {
    if (!issue.formulaId) {
      return true;
    }

    const entry = state.formulaIndex.get(issue.formulaId);
    return !entry || formulaEntryMatchesDocument(state, entry, editor.document);
  });

  return {
    activeDocument: editor.document.fileName,
    checkedFormulaCount: entries.length,
    issues: visibleIssues,
  };
}

function severityRank(severity: LocalHealthSeverity): number {
  if (severity === "error") {
    return 0;
  }
  if (severity === "warning") {
    return 1;
  }
  return 2;
}

export function localHealthCheckToMarkdown(report: LocalHealthReport): string {
  const sortedIssues = [...report.issues].sort((left, right) => {
    const severity = severityRank(left.severity) - severityRank(right.severity);
    if (severity !== 0) {
      return severity;
    }
    return (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
  });

  const counts = {
    error: sortedIssues.filter((issue) => issue.severity === "error").length,
    warning: sortedIssues.filter((issue) => issue.severity === "warning").length,
    info: sortedIssues.filter((issue) => issue.severity === "info").length,
  };

  const lines: string[] = [
    "# CalcDocs Local Formula Health Check",
    "",
    `Document: \`${report.activeDocument}\``,
    `Formulas checked: ${report.checkedFormulaCount}`,
    `Issues: ${counts.error} error, ${counts.warning} warning, ${counts.info} info`,
  ];

  if (sortedIssues.length === 0) {
    lines.push("", "No health issues are present in the current computed state.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "## Issues");
  for (const issue of sortedIssues) {
    const location = issue.line ? `L${issue.line}` : "current document";
    const formula = issue.formulaId ? ` \`${issue.formulaId}\`` : "";
    lines.push(
      `- **${issue.severity}** ${location}${formula} (${issue.category}): ${issue.message}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function showLocalFormulaHealthCheck(
  state: CalcDocsState
): Promise<void> {
  const report = buildLocalFormulaHealthCheck(state);
  if (!report) {
    await vscode.window.showWarningMessage("CalcDocs: open a document to run a local health check.");
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: localHealthCheckToMarkdown(report),
  });
  await vscode.window.showTextDocument(document, { preview: false });
}