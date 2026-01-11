/**
 * Statistics WebviewView provider
 * Shows score and category percent-bars in the sidebar
 */

import * as vscode from 'vscode';
import type { VacuumStatistics } from '../core/types';
import { IReportStore, ReportStoreEvent } from '../core/report-store';

/**
 * Message types for statistics webview
 */
type StatsMessage =
  | { type: 'stats:update'; payload: VacuumStatistics }
  | { type: 'stats:loading' }
  | { type: 'stats:error'; payload: string }
  | { type: 'stats:clear' };

/**
 * WebviewViewProvider for statistics sidebar widget
 */
export class StatisticsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vacuumStatistics';

  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _store: IReportStore
  ) {
    // Subscribe to store changes
    this._disposables.push(
      _store.subscribe((event) => this._onStoreEvent(event))
    );
  }

  private _onStoreEvent(event: ReportStoreEvent): void {
    console.log('[Statistics] Store event:', event.type, 'view exists:', !!this._view);
    if (!this._view) return;

    switch (event.type) {
      case 'loading':
        this._postMessage({ type: 'stats:loading' });
        break;

      case 'updated':
        if (event.report.statistics) {
          console.log('[Statistics] Sending updated stats, score:', event.report.statistics.overallScore);
          this._postMessage({
            type: 'stats:update',
            payload: event.report.statistics,
          });
        } else {
          console.log('[Statistics] No statistics in report');
          this._postMessage({ type: 'stats:clear' });
        }
        break;

      case 'error':
        this._postMessage({
          type: 'stats:error',
          payload: event.error,
        });
        break;

      case 'cleared':
        this._postMessage({ type: 'stats:clear' });
        break;
    }
  }

  private _postMessage(message: StatsMessage): void {
    this._view?.webview.postMessage(message);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message) => {
      console.log('[Statistics] Received message from webview:', message);
      if (message.type === 'webview:ready') {
        // Send current state
        const report = this._store.currentReport;
        if (report) {
          console.log('[Statistics] Sending stats update');
          this._postMessage({
            type: 'stats:update',
            payload: report.statistics,
          });
        } else if (this._store.isLoading) {
          console.log('[Statistics] Sending loading state');
          this._postMessage({ type: 'stats:loading' });
        } else {
          console.log('[Statistics] Sending clear/empty state');
          this._postMessage({ type: 'stats:clear' });
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'statistics.js')
    );

    const nonce = getNonce();

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>vacuum statistics</title>
  <style>
    :root {
      --pb33f-bg-primary: #0d1117;
      --pb33f-bg-secondary: #161b22;
      --pb33f-text-primary: #e6edf3;
      --pb33f-text-secondary: #8b949e;
      --pb33f-cyan: #62c4ff;
      --pb33f-magenta: #f83aff;
      --pb33f-green: #3fb950;
      --pb33f-yellow: #d29922;
      --pb33f-red: #f85149;
      --pb33f-border: #30363d;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-sideBar-background, var(--pb33f-bg-primary));
      color: var(--vscode-sideBar-foreground, var(--pb33f-text-primary));
      padding: 12px;
      min-height: 100vh;
    }

    .loading, .empty, .error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 12px;
      text-align: center;
      color: var(--pb33f-text-secondary);
    }

    .error {
      color: var(--pb33f-red);
    }

    .score-container {
      text-align: center;
      margin-bottom: 16px;
      padding: 16px;
      background: var(--vscode-editor-background, var(--pb33f-bg-secondary));
      border: 1px solid var(--pb33f-border);
    }

    .score-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--pb33f-text-secondary);
      margin-bottom: 8px;
    }

    .score-value {
      font-size: 48px;
      font-weight: bold;
      line-height: 1;
    }

    .score-value.excellent { color: var(--pb33f-green); }
    .score-value.good { color: var(--pb33f-cyan); }
    .score-value.fair { color: var(--pb33f-yellow); }
    .score-value.poor { color: var(--pb33f-red); }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
      margin-bottom: 16px;
    }

    .stat-item {
      background: var(--vscode-editor-background, var(--pb33f-bg-secondary));
      padding: 8px;
      border: 1px solid var(--pb33f-border);
      text-align: center;
    }

    .stat-value {
      font-size: 20px;
      font-weight: bold;
      color: var(--pb33f-cyan);
    }

    .stat-value.errors { color: var(--pb33f-red); }
    .stat-value.warnings { color: var(--pb33f-yellow); }
    .stat-value.info { color: var(--pb33f-cyan); }

    .stat-label {
      font-size: 10px;
      text-transform: uppercase;
      color: var(--pb33f-text-secondary);
    }

    .categories-section {
      margin-top: 16px;
    }

    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--pb33f-text-secondary);
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--pb33f-border);
    }

    .category-item {
      margin-bottom: 12px;
    }

    .category-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .category-name {
      font-size: 12px;
      color: var(--pb33f-text-primary);
    }

    .category-issues-count {
      font-size: 11px;
      color: var(--pb33f-text-secondary);
    }

    .category-score.excellent { color: var(--pb33f-green); }
    .category-score.good { color: var(--pb33f-cyan); }
    .category-score.fair { color: var(--pb33f-yellow); }
    .category-score.poor { color: var(--pb33f-red); }

    .percent-bar {
      height: 6px;
      background: var(--pb33f-border);
      overflow: hidden;
    }

    .percent-bar-fill {
      height: 100%;
      transition: width 0.3s ease;
    }

    .percent-bar-fill.excellent { background: var(--pb33f-green); }
    .percent-bar-fill.good { background: var(--pb33f-cyan); }
    .percent-bar-fill.fair { background: var(--pb33f-yellow); }
    .percent-bar-fill.poor { background: var(--pb33f-red); }

    .category-issues {
      font-size: 10px;
      color: var(--pb33f-text-secondary);
      margin-top: 2px;
    }

    #content { display: none; }
    #loading { display: block; }
    #empty { display: none; }
    #error { display: none; }

    body.loaded #content { display: block; }
    body.loaded #loading { display: none; }
    body.loaded #empty { display: none; }
    body.loaded #error { display: none; }

    body.empty #content { display: none; }
    body.empty #loading { display: none; }
    body.empty #empty { display: block; }
    body.empty #error { display: none; }

    body.error #content { display: none; }
    body.error #loading { display: none; }
    body.error #empty { display: none; }
    body.error #error { display: block; }
  </style>
</head>
<body>
  <div id="loading" class="loading">
    <span>Analyzing...</span>
  </div>

  <div id="empty" class="empty">
    <span>No report loaded</span>
    <small style="margin-top: 8px;">Open an OpenAPI file and run vacuum: refresh</small>
  </div>

  <div id="error" class="error">
    <span id="error-message">Error loading report</span>
  </div>

  <div id="content">
    <div class="score-container">
      <div class="score-label">Overall Score</div>
      <div id="overall-score" class="score-value">--</div>
    </div>

    <div class="stats-grid">
      <div class="stat-item">
        <div id="errors-count" class="stat-value errors">0</div>
        <div class="stat-label">Errors</div>
      </div>
      <div class="stat-item">
        <div id="warnings-count" class="stat-value warnings">0</div>
        <div class="stat-label">Warnings</div>
      </div>
      <div class="stat-item">
        <div id="info-count" class="stat-value info">0</div>
        <div class="stat-label">Info</div>
      </div>
    </div>

    <div class="categories-section">
      <div class="section-title">Problem Categories</div>
      <div id="categories"></div>
    </div>
  </div>

  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

/**
 * Generate a nonce for CSP
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Register the statistics webview view
 */
export function registerStatisticsView(
  context: vscode.ExtensionContext,
  store: IReportStore
): StatisticsViewProvider {
  const provider = new StatisticsViewProvider(context.extensionUri, store);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(StatisticsViewProvider.viewType, provider)
  );

  return provider;
}
