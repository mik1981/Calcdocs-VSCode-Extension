import * as vscode from "vscode";

import { evaluateInlineCalcs, type InlineCalcResult } from "../core/inlineCalc";
import { CalcDocsState } from "../core/state";
import type { FormulaRegistry } from "../formulaOutline/formulaRegistry";
import type { OutlineFormula } from "../formulaOutline/formulaParser";
import {
  FormulaViewMode,
  FormulaSortOrder,
  GROUP_HEADER_LABEL_PREFIX,
  GROUP_HEADER_COLLAPSIBLE,
  FORMULA_ITEM_COLLAPSIBLE,
  CONTEXT_VIEW_MODE,
  CONTEXT_HAS_GROUPS,
  CONTEXT_HAS_PHYSICS,
} from "./formulaViewTypes";
import { computeDependencyGroups, type DependencyGroup } from "../formulaOutline/dependencyGraph";
import { computePhysicsClusters } from "../analysis/dimClustering";

const ITEM_SOURCE_MAX_LEN = 72;

function clampText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function createInfoItem(label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("info");
  return item;
}

function toItemIcon(result: InlineCalcResult): vscode.ThemeIcon {
  if (result.severity === "error") {
    return new vscode.ThemeIcon("error");
  }
  if (result.severity === "warning") {
    return new vscode.ThemeIcon("warning");
  }
  return new vscode.ThemeIcon(
    result.kind === "assign" ? "symbol-variable" : "symbol-number"
  );
}

function toFormulaItemIcon(formula: OutlineFormula): vscode.ThemeIcon {
  if (formula.expr && formula.expr.length > 0) {
    return new vscode.ThemeIcon("symbol-function");
  }
  return new vscode.ThemeIcon("symbol-constant");
}

function isYamlFormulaFile(document: vscode.TextDocument): boolean {
  const fileName = document.fileName.toLowerCase();
  return (
    document.languageId === "yaml" &&
    /.*formulas.*\.ya?ml$/i.test(fileName)
  );
}

function sortFormulas(
  formulas: OutlineFormula[],
  order: FormulaSortOrder
): OutlineFormula[] {
  if (order === FormulaSortOrder.Alphabetical) {
    return [...formulas].sort((a, b) => a.id.localeCompare(b.id));
  }
  return [...formulas];
}

function filterFormulas(
  formulas: OutlineFormula[],
  filterText: string
): OutlineFormula[] {
  if (!filterText) return formulas;
  const lower = filterText.toLowerCase();
  return formulas.filter(
    (f) =>
      f.id.toLowerCase().includes(lower) ||
      (f.expr && f.expr.toLowerCase().includes(lower)) ||
      (f.desc && f.desc.toLowerCase().includes(lower)) ||
      (f.unit && f.unit.toLowerCase().includes(lower))
  );
}

class DependencyGroupRootItem extends vscode.TreeItem {
  constructor(
    public readonly group: DependencyGroup,
    public readonly sourceUri: vscode.Uri,
    public readonly allFormulas: Map<string, OutlineFormula>
  ) {
    super(
      `${GROUP_HEADER_LABEL_PREFIX}${group.sink}`,
      GROUP_HEADER_COLLAPSIBLE
    );
    this.description = `${group.formulaIds.length} formulas`;
    this.tooltip = `Dependency Group rooted at "${group.sink}"\n${group.formulaIds.length} formulas in transitive closure`;
    this.iconPath = new vscode.ThemeIcon("graph");
    this.contextValue = 'dependencyGroup';
  }
}

class DependencyGroupFormulaItem extends vscode.TreeItem {
  constructor(
    public readonly formula: OutlineFormula,
    public readonly sourceUri: vscode.Uri
  ) {
    super(clampText(formula.id, ITEM_SOURCE_MAX_LEN), FORMULA_ITEM_COLLAPSIBLE);
    this.description =
      formula.expr && formula.expr.length > 0
        ? `= ${clampText(formula.expr, ITEM_SOURCE_MAX_LEN)}`
        : formula.value !== undefined
          ? `${formula.value}${formula.unit ? ` ${formula.unit}` : ""}`
          : "—";
    this.tooltip = [
      `ID: ${formula.id}`,
      `Line: L${formula.lineStart + 1}`,
      formula.expr ? `Expression: ${formula.expr}` : '',
      formula.unit ? `Unit: ${formula.unit}` : '',
      formula.value !== undefined ? `Value: ${formula.value}` : '',
      formula.desc ? `Description: ${formula.desc}` : '',
    ]
      .filter(Boolean)
      .join("\n");
    this.iconPath = toFormulaItemIcon(formula);
    this.command = {
      command: "calcdocs.inlineCalc.openResult",
      title: "Open formula",
      arguments: [sourceUri, formula.lineStart],
    };
    this.contextValue = 'dependencyGroupFormula';
  }
}

class PhysicsClusterRootItem extends vscode.TreeItem {
  public readonly clusters: { label: string; formulaIds: string[] }[];

  constructor(
    public readonly group: { sink: string; clusters: { label: string; formulaIds: string[] }[] },
    public readonly sourceUri: vscode.Uri,
    public readonly allFormulas: Map<string, OutlineFormula>
  ) {
    super(
      `${GROUP_HEADER_LABEL_PREFIX}${group.sink}`,
      GROUP_HEADER_COLLAPSIBLE
    );
    this.clusters = group.clusters;
    const allIds = group.clusters.flatMap(c => c.formulaIds);
    this.description = `${allIds.length} formulas`;
    this.tooltip = `Physics-Aware Dependency Group\n${group.clusters.length} physical clusters`;
    this.iconPath = new vscode.ThemeIcon("graph");
    this.contextValue = 'physicsClusterRoot';
  }
}

class PhysicsClusterItem extends vscode.TreeItem {
  constructor(
    public readonly cluster: { label: string; formulaIds: string[] },
    public readonly sourceUri: vscode.Uri,
    public readonly allFormulas: Map<string, OutlineFormula>
  ) {
    super(
      `[${cluster.label}]`,
      GROUP_HEADER_COLLAPSIBLE
    );
    this.description = `${cluster.formulaIds.length} formulas`;
    this.tooltip = `Physical Cluster: ${cluster.label}\n${cluster.formulaIds.length} formulas`;
    this.iconPath = new vscode.ThemeIcon("symbol-namespace");
    this.contextValue = 'physicsCluster';
  }

  getChildren(): vscode.TreeItem[] {
    return this.cluster.formulaIds.map((fid) => {
      const formula = this.allFormulas.get(fid);
      if (formula) {
        return new DependencyGroupFormulaItem(formula, this.sourceUri);
      }
      const fallback = new vscode.TreeItem(fid, vscode.TreeItemCollapsibleState.None);
      fallback.description = "?";
      return fallback;
    });
  }
}

export class InlineCalcResultsViewProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly emitter = new vscode.EventEmitter<void>();
  private activeDocument: vscode.TextDocument | undefined;

  private _viewMode: FormulaViewMode = FormulaViewMode.Flat;
  private _sortOrder: FormulaSortOrder = FormulaSortOrder.Source;
  private _filterText: string = '';

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly state: CalcDocsState,
    private readonly formulaRegistry?: FormulaRegistry
  ) {}

  get viewMode(): FormulaViewMode {
    return this._viewMode;
  }

  get sortOrder(): FormulaSortOrder {
    return this._sortOrder;
  }

  get filterText(): string {
    return this._filterText;
  }

  setViewMode(mode: FormulaViewMode): void {
    this._viewMode = mode;
    this._updateContextKeys();
    this.refresh();
  }

  setSortOrder(order: FormulaSortOrder): void {
    this._sortOrder = order;
    this.refresh();
  }

  setFilter(text: string): void {
    this._filterText = text;
    this.refresh();
  }

  clearFilter(): void {
    this._filterText = '';
    this.refresh();
  }

  setActiveEditor(editor: vscode.TextEditor | undefined): void {
    this.activeDocument = editor?.document;
    this._updateContextKeys();
    this.refresh();
  }

  notifyDocumentChanged(document: vscode.TextDocument): void {
    if (!this.activeDocument) {
      return;
    }
    if (this.activeDocument.uri.toString() !== document.uri.toString()) {
      return;
    }
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) {
      return this._getChildrenInternal(element);
    }

    const items: vscode.TreeItem[] = [];

    if (!this.state.enabled) {
      items.push(createInfoItem("CalcDocs is disabled"));
      return items;
    }

    if (!this.activeDocument) {
      items.push(createInfoItem("Open a C/C++ or YAML file to see results"));
      return items;
    }

    if (isYamlFormulaFile(this.activeDocument)) {
      return this._getFormulaView(this.activeDocument);
    }

    if (this.activeDocument.languageId !== "c" && this.activeDocument.languageId !== "cpp") {
      items.push(createInfoItem("Inline calculations are only available in C/C++ files"));
      return items;
    }

    const results = evaluateInlineCalcs(
      this.activeDocument.getText(),
      this.state,
      {},
      this.activeDocument.languageId
    );

    if (results.length === 0) {
      items.push(createInfoItem("No inline calculations (= ...) or formulas file found (formula*.yaml)"));
      return items;
    }

    for (const result of results) {
      const lineLabel = `L${result.line + 1}`;
      const prefix = result.kind === "assign" ? "@" : "=";
      const label = `${lineLabel} ${prefix} ${clampText(
        result.source,
        ITEM_SOURCE_MAX_LEN
      )}`;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.description =
        result.severity === "error"
          ? `ERROR: ${result.error ?? "unresolved"}`
          : result.severity === "warning"
            ? `WARN: ${result.warnings[0] ?? result.displayValue}`
            : result.displayValue;
      item.tooltip = [
        `${lineLabel}: ${result.source}`,
        `Result: ${result.displayValue}`,
        `Dimension: ${result.dimensionText}`,
        ...result.warnings.map((warning) => `Warning: ${warning}`),
        result.error ? `Error: ${result.error}` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n");
      item.iconPath = toItemIcon(result);
      item.command = {
        command: "calcdocs.inlineCalc.openResult",
        title: "Open inline calc result",
        arguments: [this.activeDocument.uri, result.line],
      };
      items.push(item);
    }

    return items;
  }

  private _getChildrenInternal(element: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof DependencyGroupRootItem) {
      return element.group.formulaIds.map((fid) => {
        const formula = element.allFormulas.get(fid);
        if (formula) {
          return new DependencyGroupFormulaItem(formula, element.sourceUri);
        }
        const fallbackItem = new vscode.TreeItem(fid, vscode.TreeItemCollapsibleState.None);
        fallbackItem.description = "?";
        return fallbackItem;
      });
    }

    if (element instanceof PhysicsClusterRootItem) {
      return element.clusters.map((cluster) => {
        return new PhysicsClusterItem(cluster, element.sourceUri, element.allFormulas);
      });
    }

    if (element instanceof PhysicsClusterItem) {
      return element.getChildren();
    }

    return [];
  }

  private _getFormulaView(document: vscode.TextDocument): vscode.TreeItem[] {
    if (!this.formulaRegistry) {
      return [createInfoItem("FormulaRegistry not initialized")];
    }

    const formulas = this.formulaRegistry['formulas'].get(document.uri.toString()) ?? [];

    if (formulas.length === 0) {
      return [createInfoItem("No formulas found in this file")];
    }

    if (this._viewMode === FormulaViewMode.PhysicsClusters) {
      return this._getPhysicsClustersView(document, formulas);
    }

    if (this._viewMode === FormulaViewMode.DependencyGroups) {
      return this._getDependencyGroupsView(document, formulas);
    }

    return this._getFlatFormulaView(document, formulas);
  }

  private _getFlatFormulaView(
    document: vscode.TextDocument,
    formulas: OutlineFormula[]
  ): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    let visible = this._filterText ? filterFormulas(formulas, this._filterText) : formulas;
    visible = sortFormulas(visible, this._sortOrder);

    if (visible.length === 0 && this._filterText) {
      items.push(createInfoItem(`No formulas matching "${this._filterText}"`));
      return items;
    }

    for (const formula of visible) {
      items.push(this._createFormulaTreeItem(formula, document.uri));
    }
    return items;
  }

  private _getPhysicsClustersView(
    document: vscode.TextDocument,
    formulas: OutlineFormula[]
  ): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    let filtered = this._filterText ? filterFormulas(formulas, this._filterText) : formulas;

    try {
      const groups = computePhysicsClusters(filtered);

      if (groups.length === 0) {
        if (this._filterText) {
          items.push(createInfoItem(`No physics clusters matching "${this._filterText}"`));
        } else {
          items.push(createInfoItem("No physics clusters (all formulas are sinks?)"));
        }
        return items;
      }

      const formulaMap = new Map<string, OutlineFormula>();
      for (const f of formulas) {
        formulaMap.set(f.id, f);
      }

      for (const group of groups) {
        items.push(new PhysicsClusterRootItem(group, document.uri, formulaMap));
      }
    } catch {
      items.push(createInfoItem("Physics analysis unavailable for this document"));
    }

    return items;
  }

  private _getDependencyGroupsView(
    document: vscode.TextDocument,
    formulas: OutlineFormula[]
  ): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    let filtered = this._filterText ? filterFormulas(formulas, this._filterText) : formulas;

    const groups = computeDependencyGroups(filtered);

    if (groups.length === 0) {
      if (this._filterText) {
        items.push(createInfoItem(`No groups matching "${this._filterText}"`));
      } else {
        items.push(createInfoItem("No dependency groups (all formulas are sinks?)"));
      }
      return items;
    }

    const formulaMap = new Map<string, OutlineFormula>();
    for (const f of formulas) {
      formulaMap.set(f.id, f);
    }

    for (const group of groups) {
      items.push(new DependencyGroupRootItem(group, document.uri, formulaMap));
    }

    return items;
  }

  private _createFormulaTreeItem(
    formula: OutlineFormula,
    uri: vscode.Uri
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      clampText(formula.id, ITEM_SOURCE_MAX_LEN),
      FORMULA_ITEM_COLLAPSIBLE
    );

    const description =
      formula.expr && formula.expr.length > 0
        ? `= ${clampText(formula.expr, ITEM_SOURCE_MAX_LEN)}`
        : formula.value !== undefined
          ? `${formula.value}${formula.unit ? ` ${formula.unit}` : ""}`
          : "—";

    item.description = description;

    const tooltipLines = [
      `ID: ${formula.id}`,
      `Line: L${formula.lineStart + 1}`,
    ];

    if (formula.expr && formula.expr.length > 0) {
      tooltipLines.push(`Expression: ${formula.expr}`);
    }
    if (formula.unit) {
      tooltipLines.push(`Unit: ${formula.unit}`);
    }
    if (formula.value !== undefined) {
      tooltipLines.push(`Value: ${formula.value}`);
    }
    if (formula.desc) {
      tooltipLines.push(`Description: ${formula.desc}`);
    }

    item.tooltip = tooltipLines.join("\n");
    item.iconPath = toFormulaItemIcon(formula);

    item.command = {
      command: "calcdocs.inlineCalc.openResult",
      title: "Open formula",
      arguments: [uri, formula.lineStart],
    };

    return item;
  }

  private _updateContextKeys(): void {
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_VIEW_MODE,
      this._viewMode
    );

    const hasGroups =
      (this._viewMode === FormulaViewMode.DependencyGroups ||
        this._viewMode === FormulaViewMode.PhysicsClusters) &&
      this.activeDocument &&
      isYamlFormulaFile(this.activeDocument);
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_HAS_GROUPS,
      hasGroups
    );

    const hasPhysicsClusters =
      this._viewMode === FormulaViewMode.PhysicsClusters &&
      this.activeDocument &&
      isYamlFormulaFile(this.activeDocument);
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_HAS_PHYSICS,
      hasPhysicsClusters
    );
  }
}