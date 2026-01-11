/**
 * Statistics webview main script
 * Handles messages from extension and updates the UI
 */

// Get the VS Code API
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// Category statistics interface
interface CategoryStatistic {
  categoryName: string;
  categoryId: string;
  numIssues: number;
  score: number;
  warnings: number;
  errors: number;
  info: number;
  hints: number;
}

// Statistics interface
interface VacuumStatistics {
  overallScore: number;
  totalErrors: number;
  totalWarnings: number;
  totalInfo: number;
  paths: number;
  operations: number;
  categoryStatistics: CategoryStatistic[];
}

// Message types
type StatsMessage =
  | { type: 'stats:update'; payload: VacuumStatistics }
  | { type: 'stats:loading' }
  | { type: 'stats:error'; payload: string }
  | { type: 'stats:clear' };

/**
 * Get impact class based on impact value (higher = worse)
 */
function getImpactClass(impact: number): string {
  if (impact >= 50) return 'poor';      // High impact = red
  if (impact >= 30) return 'fair';      // Medium impact = yellow
  if (impact >= 10) return 'good';      // Low impact = cyan
  return 'excellent';                    // Minimal impact = green
}

/**
 * Get score class based on value (for overall score display)
 */
function getScoreClass(score: number): string {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

/**
 * Update the UI with statistics data
 */
function updateStats(stats: VacuumStatistics): void {
  document.body.className = 'loaded';

  // Overall score
  const scoreEl = document.getElementById('overall-score');
  if (scoreEl) {
    scoreEl.textContent = String(Math.round(stats.overallScore));
    scoreEl.className = `score-value ${getScoreClass(stats.overallScore)}`;
  }

  // Counts - Errors, Warnings, Info
  const errorsEl = document.getElementById('errors-count');
  if (errorsEl) errorsEl.textContent = String(stats.totalErrors);

  const warningsEl = document.getElementById('warnings-count');
  if (warningsEl) warningsEl.textContent = String(stats.totalWarnings);

  const infoEl = document.getElementById('info-count');
  if (infoEl) infoEl.textContent = String(stats.totalInfo || 0);

  // Category bars - Problem Categories
  const categoriesEl = document.getElementById('categories');
  if (categoriesEl && stats.categoryStatistics) {
    // Filter out 100% categories (no problems)
    const problemCategories = stats.categoryStatistics.filter(cat => cat.score < 100);

    // Sort by number of issues descending (most issues first)
    const sorted = problemCategories.sort((a, b) => {
      const aIssues = a.errors + a.warnings + a.info + a.hints;
      const bIssues = b.errors + b.warnings + b.info + b.hints;
      return bIssues - aIssues;
    });

    // Calculate max issues for relative bar sizing
    const maxIssues = sorted.length > 0
      ? Math.max(...sorted.map(cat => cat.errors + cat.warnings + cat.info + cat.hints))
      : 1;

    categoriesEl.innerHTML = sorted
      .map((cat) => {
        const issues = cat.errors + cat.warnings + cat.info + cat.hints;
        // Impact is inverted - more issues = higher bar
        const impact = Math.round((issues / maxIssues) * 100);
        const impactClass = getImpactClass(100 - cat.score); // Use score to determine color

        return `
          <div class="category-item">
            <div class="category-header">
              <span class="category-name">${cat.categoryName}</span>
              <span class="category-issues-count">${issues} issue${issues !== 1 ? 's' : ''}</span>
            </div>
            <div class="percent-bar">
              <div class="percent-bar-fill ${impactClass}" style="width: ${impact}%"></div>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

/**
 * Show loading state
 */
function showLoading(): void {
  document.body.className = '';
}

/**
 * Show empty state
 */
function showEmpty(): void {
  document.body.className = 'empty';
}

/**
 * Show error state
 */
function showError(message: string): void {
  document.body.className = 'error';
  const errorEl = document.getElementById('error-message');
  if (errorEl) errorEl.textContent = message;
}

// Listen for messages from the extension
window.addEventListener('message', (event) => {
  const message = event.data as StatsMessage;

  switch (message.type) {
    case 'stats:update':
      updateStats(message.payload);
      break;

    case 'stats:loading':
      showLoading();
      break;

    case 'stats:error':
      showError(message.payload);
      break;

    case 'stats:clear':
      showEmpty();
      break;
  }
});

// Notify extension that webview is ready
console.log('[Statistics Webview] Sending webview:ready');
vscode.postMessage({ type: 'webview:ready' });

// Start with empty state
showEmpty();

console.log('[Statistics Webview] Initialized and ready');
