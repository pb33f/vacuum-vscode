/**
 * TreeView provider for vacuum violations
 * Grouped by severity first, then by category
 */

import * as vscode from 'vscode';
import type { VacuumReport, VacuumResult, VacuumSeverity, VacuumRule } from '../core/types';
import { SEVERITY_ORDER, SEVERITY_LABELS, SEVERITY_ICONS } from '../core/types';
import { IReportStore, ReportStoreEvent } from '../core/report-store';

/**
 * Tree item types for the violations tree
 */
type ViolationTreeItem = SeverityNode | CategoryNode | ViolationNode;

/**
 * Severity grouping node (Errors, Warnings, etc.)
 */
class SeverityNode extends vscode.TreeItem {
  constructor(
    public readonly severity: VacuumSeverity,
    public readonly count: number,
    public readonly categories: Map<string, VacuumResult[]>
  ) {
    super(
      `${SEVERITY_LABELS[severity]} (${count})`,
      count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );

    this.iconPath = new vscode.ThemeIcon(SEVERITY_ICONS[severity]);
    this.contextValue = 'severity';
  }
}

/**
 * Category grouping node (schemas, operations, etc.)
 */
class CategoryNode extends vscode.TreeItem {
  constructor(
    public readonly categoryId: string,
    public readonly categoryName: string,
    public readonly violations: VacuumResult[],
    public readonly rules: Record<string, VacuumRule>
  ) {
    super(
      `${categoryName} (${violations.length})`,
      vscode.TreeItemCollapsibleState.Collapsed
    );

    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'category';
    this.tooltip = this.getCategoryDescription();
  }

  private getCategoryDescription(): string {
    // Get description from first rule in this category
    for (const violation of this.violations) {
      const rule = this.rules[violation.ruleId];
      if (rule?.category?.description) {
        return rule.category.description;
      }
    }
    return this.categoryName;
  }
}

/**
 * Individual violation node
 */
class ViolationNode extends vscode.TreeItem {
  constructor(
    public readonly result: VacuumResult,
    public readonly rule: VacuumRule | undefined,
    public readonly filePath: string
  ) {
    // Show rule ID and line number
    super(
      `${result.ruleId}: Line ${result.range.start.line}`,
      vscode.TreeItemCollapsibleState.None
    );

    this.description = result.message;
    this.tooltip = this.buildTooltip();
    this.iconPath = new vscode.ThemeIcon(SEVERITY_ICONS[result.ruleSeverity]);
    this.contextValue = 'violation';

    // Command to navigate to the violation
    this.command = {
      command: 'vacuum.navigateToViolation',
      title: 'Go to Violation',
      arguments: [filePath, result.range.start.line, result.range.start.character],
    };
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.result.ruleId}**\n\n`);
    md.appendMarkdown(`${this.result.message}\n\n`);
    md.appendMarkdown(`**Path:** \`${this.result.path}\`\n\n`);
    md.appendMarkdown(`**Line:** ${this.result.range.start.line}\n\n`);

    if (this.rule?.howToFix) {
      md.appendMarkdown(`---\n\n**How to fix:**\n\n${this.rule.howToFix}`);
    }

    return md;
  }
}

/**
 * TreeDataProvider for violations
 */
export class ViolationsTreeProvider implements vscode.TreeDataProvider<ViolationTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ViolationTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _report: VacuumReport | null = null;
  private _filePath: string | null = null;
  private _isLoading = false;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly store: IReportStore) {
    // Subscribe to store changes
    this._disposables.push(
      store.subscribe((event) => this._onStoreEvent(event))
    );
  }

  private _onStoreEvent(event: ReportStoreEvent): void {
    console.log('[vacuum] ViolationsTree received event:', event.type);
    switch (event.type) {
      case 'loading':
        this._isLoading = true;
        this._filePath = event.filePath;
        this._onDidChangeTreeData.fire();
        break;

      case 'updated':
        this._isLoading = false;
        this._report = event.report;
        this._filePath = event.filePath;
        const resultCount = event.report.resultSet?.results?.length ?? 0;
        console.log('[vacuum] ViolationsTree updating with', resultCount, 'results');
        this._onDidChangeTreeData.fire();
        break;

      case 'error':
        this._isLoading = false;
        this._onDidChangeTreeData.fire();
        break;

      case 'cleared':
        this._isLoading = false;
        this._report = null;
        this._filePath = null;
        this._onDidChangeTreeData.fire();
        break;
    }
  }

  getTreeItem(element: ViolationTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ViolationTreeItem): ViolationTreeItem[] {
    // Loading state
    if (this._isLoading) {
      return [this._createMessageItem('Loading...', 'loading~spin')];
    }

    // No report loaded
    if (!this._report || !this._filePath) {
      return [this._createMessageItem('No report loaded', 'info')];
    }

    // Root level: severity nodes
    if (!element) {
      return this._getSeverityNodes();
    }

    // Severity level: category nodes
    if (element instanceof SeverityNode) {
      return this._getCategoryNodes(element);
    }

    // Category level: violation nodes
    if (element instanceof CategoryNode) {
      return this._getViolationNodes(element);
    }

    return [];
  }

  /**
   * Get severity nodes (root level)
   */
  private _getSeverityNodes(): SeverityNode[] {
    if (!this._report) return [];

    const results = this._report.resultSet?.results ?? [];
    const rules = this._report.rules ?? {};

    // If no results, show empty state
    if (results.length === 0) {
      return [];
    }

    // Group by severity, then by category
    const severityGroups = new Map<VacuumSeverity, Map<string, VacuumResult[]>>();

    for (const result of results) {
      const severity = result.ruleSeverity;
      const rule = rules[result.ruleId];
      const categoryId = rule?.category?.id || 'unknown';

      if (!severityGroups.has(severity)) {
        severityGroups.set(severity, new Map());
      }

      const categoryMap = severityGroups.get(severity)!;
      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, []);
      }

      categoryMap.get(categoryId)!.push(result);
    }

    // Create nodes sorted by severity order
    const severities: VacuumSeverity[] = ['error', 'warn', 'info', 'hint'];
    const nodes: SeverityNode[] = [];

    for (const severity of severities) {
      const categories = severityGroups.get(severity) || new Map();
      let count = 0;
      for (const violations of categories.values()) {
        count += violations.length;
      }

      // Only show severities with violations (or errors/warnings always)
      if (count > 0 || severity === 'error' || severity === 'warn') {
        nodes.push(new SeverityNode(severity, count, categories));
      }
    }

    return nodes;
  }

  /**
   * Get category nodes for a severity
   */
  private _getCategoryNodes(severityNode: SeverityNode): CategoryNode[] {
    if (!this._report) return [];

    const nodes: CategoryNode[] = [];
    const rules = this._report.rules;

    // Sort categories by violation count (descending)
    const sortedCategories = [...severityNode.categories.entries()]
      .sort((a, b) => b[1].length - a[1].length);

    for (const [categoryId, violations] of sortedCategories) {
      // Get category name from first rule
      let categoryName = categoryId;
      for (const violation of violations) {
        const rule = rules[violation.ruleId];
        if (rule?.category?.name) {
          categoryName = rule.category.name;
          break;
        }
      }

      nodes.push(new CategoryNode(categoryId, categoryName, violations, rules));
    }

    return nodes;
  }

  /**
   * Get violation nodes for a category
   */
  private _getViolationNodes(categoryNode: CategoryNode): ViolationNode[] {
    if (!this._report || !this._filePath) return [];

    const rules = this._report.rules;

    // Sort by line number
    const sortedViolations = [...categoryNode.violations]
      .sort((a, b) => a.range.start.line - b.range.start.line);

    return sortedViolations.map(
      (result) => new ViolationNode(result, rules[result.ruleId], this._filePath!)
    );
  }

  /**
   * Create a simple message item
   */
  private _createMessageItem(message: string, icon: string): vscode.TreeItem {
    const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(icon);
    return item as ViolationTreeItem;
  }

  /**
   * Refresh the tree
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Register the violations tree view and navigation command
 */
export function registerViolationsTree(
  context: vscode.ExtensionContext,
  store: IReportStore
): ViolationsTreeProvider {
  const provider = new ViolationsTreeProvider(store);

  // Register tree view
  const treeView = vscode.window.createTreeView('vacuumViolations', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  // Register navigation command
  const navigateCmd = vscode.commands.registerCommand(
    'vacuum.navigateToViolation',
    async (filePath: string, line: number, character: number) => {
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(document);

        // Convert 1-based line to 0-based for VS Code
        const position = new vscode.Position(line - 1, character);
        const selection = new vscode.Selection(position, position);

        editor.selection = selection;
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to navigate: ${error}`);
      }
    }
  );

  context.subscriptions.push(treeView, navigateCmd, provider);

  return provider;
}
