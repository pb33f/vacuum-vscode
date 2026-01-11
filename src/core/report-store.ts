/**
 * ReportStore - Central state management for vacuum reports
 * Observable pattern - TreeView and webviews subscribe to changes
 */

import * as vscode from 'vscode';
import type { VacuumReport } from './types';
import { runVacuumReport, RunnerOptions } from './cli-runner';

export interface RefreshOptions extends RunnerOptions {
  /** Live document content (if provided, uses stdin instead of file) */
  content?: string;
}

export interface IReportStore {
  readonly currentReport: VacuumReport | null;
  readonly currentFile: string | null;
  readonly isLoading: boolean;
  readonly lastError: string | null;

  subscribe(listener: ReportListener): vscode.Disposable;
  refresh(filePath: string, options?: RefreshOptions): Promise<void>;
  refreshNow(filePath: string, options?: RefreshOptions): Promise<void>;
  clear(): void;
}

export type ReportListener = (event: ReportStoreEvent) => void;

export type ReportStoreEvent =
  | { type: 'loading'; filePath: string }
  | { type: 'updated'; report: VacuumReport; filePath: string }
  | { type: 'error'; error: string; filePath: string }
  | { type: 'cleared' };

/**
 * Singleton ReportStore implementation
 */
export class ReportStore implements IReportStore {
  private static _instance: ReportStore | null = null;

  private _currentReport: VacuumReport | null = null;
  private _currentFile: string | null = null;
  private _isLoading = false;
  private _lastError: string | null = null;
  private _listeners = new Set<ReportListener>();
  private _cancellationTokenSource: vscode.CancellationTokenSource | null = null;
  private _debounceTimer: NodeJS.Timeout | null = null;

  /** Debounce delay in ms */
  private readonly DEBOUNCE_DELAY = 500;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): ReportStore {
    if (!ReportStore._instance) {
      ReportStore._instance = new ReportStore();
    }
    return ReportStore._instance;
  }

  // Getters
  get currentReport(): VacuumReport | null {
    return this._currentReport;
  }

  get currentFile(): string | null {
    return this._currentFile;
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  /**
   * Subscribe to report changes
   * @returns Disposable to unsubscribe
   */
  subscribe(listener: ReportListener): vscode.Disposable {
    this._listeners.add(listener);
    return new vscode.Disposable(() => {
      this._listeners.delete(listener);
    });
  }

  /**
   * Refresh the report for a file
   * Debounced to prevent rapid successive calls
   */
  async refresh(filePath: string, options: RefreshOptions = {}): Promise<void> {
    // Clear any pending debounce
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    // Debounce the actual refresh
    return new Promise((resolve) => {
      this._debounceTimer = setTimeout(async () => {
        await this._doRefresh(filePath, options);
        resolve();
      }, this.DEBOUNCE_DELAY);
    });
  }

  /**
   * Force immediate refresh without debouncing
   */
  async refreshNow(filePath: string, options: RefreshOptions = {}): Promise<void> {
    // Clear any pending debounce
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    await this._doRefresh(filePath, options);
  }

  /**
   * Internal refresh implementation
   */
  private async _doRefresh(filePath: string, options: RefreshOptions): Promise<void> {
    console.log('[vacuum] ReportStore._doRefresh called for:', filePath);

    // Cancel any in-flight request
    if (this._cancellationTokenSource) {
      this._cancellationTokenSource.cancel();
      this._cancellationTokenSource.dispose();
    }

    this._cancellationTokenSource = new vscode.CancellationTokenSource();
    const cancellationToken = this._cancellationTokenSource.token;

    // Notify loading
    this._isLoading = true;
    this._currentFile = filePath;
    this._lastError = null;
    console.log('[vacuum] ReportStore emitting loading event');
    this._emit({ type: 'loading', filePath });

    try {
      const result = await runVacuumReport(filePath, {
        ...options,
        cancellationToken,
      });

      // Check if cancelled during execution
      if (cancellationToken.isCancellationRequested) {
        return;
      }

      if (result.success && result.report) {
        this._currentReport = result.report;
        this._lastError = null;
        const resultCount = result.report.resultSet?.results?.length ?? 0;
        console.log('[vacuum] ReportStore emitting updated event, results:', resultCount);
        this._emit({ type: 'updated', report: result.report, filePath });
      } else {
        this._lastError = result.error || 'Unknown error';
        console.log('[vacuum] ReportStore emitting error event:', this._lastError);
        this._emit({ type: 'error', error: this._lastError, filePath });
      }
    } catch (error) {
      if (!cancellationToken.isCancellationRequested) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this._lastError = errorMessage;
        this._emit({ type: 'error', error: errorMessage, filePath });
      }
    } finally {
      this._isLoading = false;
    }
  }

  /**
   * Clear the current report
   */
  clear(): void {
    // Cancel any in-flight request
    if (this._cancellationTokenSource) {
      this._cancellationTokenSource.cancel();
      this._cancellationTokenSource.dispose();
      this._cancellationTokenSource = null;
    }

    // Clear debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    this._currentReport = null;
    this._currentFile = null;
    this._isLoading = false;
    this._lastError = null;
    this._emit({ type: 'cleared' });
  }

  /**
   * Emit event to all listeners
   */
  private _emit(event: ReportStoreEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ReportStore] Listener error:', error);
      }
    }
  }

  /**
   * Dispose the store (for testing/cleanup)
   */
  dispose(): void {
    this.clear();
    this._listeners.clear();
    ReportStore._instance = null;
  }
}

/**
 * Get the singleton ReportStore instance
 */
export function getReportStore(): IReportStore {
  return ReportStore.getInstance();
}
