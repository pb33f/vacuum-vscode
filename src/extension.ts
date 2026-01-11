import * as vscode from 'vscode';
import * as os from 'os';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';
import { registerViolationsTree } from './providers/violations-tree';
import { registerStatisticsView } from './providers/statistics-view';
import { getReportStore } from './core/report-store';
import { isVacuumAvailable } from './core/cli-runner';

export function activate(context: vscode.ExtensionContext) {
  console.log('[vacuum] Extension activating...');

  // Get the singleton report store
  const reportStore = getReportStore();

  // Platform-aware launcher for vacuum CLI
  const launcher = os.platform() === 'win32' ? 'vacuum.cmd' : 'vacuum';

  // LSP Server configuration
  const serverOptions: ServerOptions = {
    run: { command: launcher, args: ['language-server'] },
    debug: { command: launcher, args: ['language-server'] }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'yaml' },
      { scheme: 'file', language: 'json' }
    ],
  };

  let lspClient: LanguageClient | undefined;
  let isLinting = false;

  // Register TreeView for violations
  registerViolationsTree(context, reportStore);

  // Register Statistics WebviewView
  registerStatisticsView(context, reportStore);

  /**
   * Run the CLI report and update the store
   */
  async function runReport(filePath: string, showNotification = true): Promise<void> {
    const fileName = filePath.split('/').pop() || filePath;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `vacuum: Analyzing ${fileName}...`,
        cancellable: true,
      },
      async (progress, token) => {
        const cts = new vscode.CancellationTokenSource();
        token.onCancellationRequested(() => cts.cancel());

        try {
          await reportStore.refreshNow(filePath, {
            cancellationToken: cts.token,
          });

          if (reportStore.lastError) {
            vscode.window.showErrorMessage(`vacuum: ${reportStore.lastError}`);
          } else if (reportStore.currentReport && showNotification) {
            const report = reportStore.currentReport;

            if (report.statistics) {
              const score = Math.round(report.statistics.overallScore);
              const errors = report.statistics.totalErrors;
              const warnings = report.statistics.totalWarnings;

              vscode.window.showInformationMessage(
                `vacuum: Score ${score}% | ${errors} errors | ${warnings} warnings`
              );
            } else {
              const errors = report.resultSet?.errorCount ?? 0;
              const warnings = report.resultSet?.warningCount ?? 0;
              vscode.window.showInformationMessage(
                `vacuum: ${errors} errors | ${warnings} warnings`
              );
            }
          }
        } catch (error) {
          if (!token.isCancellationRequested) {
            vscode.window.showErrorMessage(`vacuum analysis failed: ${error}`);
          }
        }
      }
    );
  }

  // Command: Start linting - unified experience
  const lint = vscode.commands.registerCommand('vacuum.lint', async () => {
    // Check if vacuum is available
    const available = await isVacuumAvailable();
    if (!available) {
      const action = await vscode.window.showErrorMessage(
        'vacuum CLI not found. Please install vacuum to use this extension.',
        'Install vacuum'
      );
      if (action === 'Install vacuum') {
        vscode.env.openExternal(vscode.Uri.parse('https://quobix.com/vacuum/'));
      }
      return;
    }

    // Get the active editor's file
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No file is open. Please open an OpenAPI file to lint.');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const language = editor.document.languageId;

    // Check if it's a YAML or JSON file
    if (language !== 'yaml' && language !== 'json') {
      vscode.window.showWarningMessage('Please open a YAML or JSON file to lint with vacuum.');
      return;
    }

    // 1. Start LSP client if not already running (for squiggly lines)
    if (!lspClient) {
      lspClient = new LanguageClient('vacuum', serverOptions, clientOptions);
      await lspClient.start();
      console.log('[vacuum] LSP client started');
    }

    // 2. Focus the Vacuum sidebar (show violations tree)
    await vscode.commands.executeCommand('workbench.view.extension.vacuum');

    // 3. Run CLI report (for rich data - tree + statistics)
    await runReport(filePath);

    // Mark as linting
    isLinting = true;

    vscode.window.showInformationMessage('vacuum is now linting your OpenAPI files.');
  });

  // Command: Stop linting
  const stopLint = vscode.commands.registerCommand('vacuum.stopLint', async () => {
    if (lspClient) {
      await lspClient.stop();
      lspClient = undefined;
      console.log('[vacuum] LSP client stopped');
    }

    // Clear the report store
    reportStore.clear();

    isLinting = false;

    vscode.window.showInformationMessage('vacuum has stopped linting.');
  });

  // Command: Refresh report (run CLI and update store)
  const refresh = vscode.commands.registerCommand('vacuum.refresh', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No file is open. Please open an OpenAPI file to analyze.');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const language = editor.document.languageId;

    if (language !== 'yaml' && language !== 'json') {
      vscode.window.showWarningMessage('Please open a YAML or JSON file to analyze with vacuum.');
      return;
    }

    const available = await isVacuumAvailable();
    if (!available) {
      const action = await vscode.window.showErrorMessage(
        'vacuum CLI not found. Please install vacuum to use this extension.',
        'Install vacuum'
      );
      if (action === 'Install vacuum') {
        vscode.env.openExternal(vscode.Uri.parse('https://quobix.com/vacuum/'));
      }
      return;
    }

    await runReport(filePath);
  });

  // Auto-refresh on file save when linting is active
  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!isLinting) return;

    const language = document.languageId;
    if (language === 'yaml' || language === 'json') {
      // Refresh report silently (no notification spam)
      console.log('[vacuum] Auto-refreshing report on save');
      await reportStore.refresh(document.uri.fsPath);
    }
  });

  // Live refresh on text changes (debounced in the store)
  const onTextChange = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (!isLinting) return;

    const document = event.document;
    const language = document.languageId;

    if (language === 'yaml' || language === 'json') {
      // Use debounced refresh with live content - store handles the debouncing
      console.log('[vacuum] Text changed, triggering debounced refresh');
      await reportStore.refresh(document.uri.fsPath, {
        content: document.getText(),
      });
    }
  });

  // Auto-refresh when switching to a different file while linting
  const onActiveEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!isLinting || !editor) return;

    const language = editor.document.languageId;
    if (language === 'yaml' || language === 'json') {
      const filePath = editor.document.uri.fsPath;

      // Only refresh if it's a different file
      if (filePath !== reportStore.currentFile) {
        console.log('[vacuum] Switching to new file, refreshing report');
        await reportStore.refresh(filePath);
      }
    }
  });

  context.subscriptions.push(
    lint,
    stopLint,
    refresh,
    onSave,
    onTextChange,
    onActiveEditorChange
  );

  console.log('[vacuum] Extension activated.');
}

export function deactivate() {
  console.log('[vacuum] Extension deactivated.');
}
