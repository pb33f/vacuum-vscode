/**
 * TypeScript interfaces for vacuum CLI JSON output
 * Generated from `vacuum report -o` command
 */

// Main report structure
export interface VacuumReport {
  generated: string;
  specInfo: VacuumSpecInfo;
  statistics: VacuumStatistics;
  resultSet: VacuumResultSet;
  rules: Record<string, VacuumRule>;
}

// Specification metadata
export interface VacuumSpecInfo {
  type: string;        // e.g., "openapi"
  version: string;     // e.g., "3.1.0"
  format: string;      // e.g., "yaml" or "json"
  numLines: number;
  fileSize: number;
  specPath: string;
}

// Overall statistics
export interface VacuumStatistics {
  filesizeBytes: number;
  filesizeKb: number;
  specType: string;
  specFormat: string;
  version: string;
  references: number;
  externalDocs: number;
  schemas: number;
  parameters: number;
  links: number;
  paths: number;
  operations: number;
  tags: number;
  examples: number;
  enums: number;
  overallScore: number;
  totalErrors: number;
  totalWarnings: number;
  totalInfo: number;
  categoryStatistics: CategoryStatistic[];
}

// Per-category statistics
export interface CategoryStatistic {
  categoryName: string;
  categoryId: string;
  numIssues: number;
  score: number;
  warnings: number;
  errors: number;
  info: number;
  hints: number;
}

// Result set containing all violations
export interface VacuumResultSet {
  results: VacuumResult[];
  warningCount: number;
  errorCount: number;
  infoCount: number;
  hintCount: number;
}

// Individual violation result
export interface VacuumResult {
  message: string;
  range: VacuumRange;
  path: string;           // JSONPath to the violation location
  ruleId: string;
  ruleSeverity: VacuumSeverity;
  origin?: VacuumOrigin;
}

// Source location range
export interface VacuumRange {
  start: VacuumPosition;
  end: VacuumPosition;
}

export interface VacuumPosition {
  line: number;      // 1-based line number
  character: number; // 0-based character offset
}

// Origin information for the violation
export interface VacuumOrigin {
  // Additional origin metadata if present
  [key: string]: unknown;
}

// Rule definition
export interface VacuumRule {
  id: string;
  description: string;
  message: string;
  severity: string;
  recommended: boolean;
  type: string;
  formats: string[];
  category: VacuumCategory;
  howToFix: string;
}

// Rule category
export interface VacuumCategory {
  id: string;
  name: string;
  description: string;
}

// Severity levels
export type VacuumSeverity = 'error' | 'warn' | 'info' | 'hint';

// Helper type for severity ordering (for TreeView grouping)
export const SEVERITY_ORDER: Record<VacuumSeverity, number> = {
  error: 0,
  warn: 1,
  info: 2,
  hint: 3,
};

// Helper type for severity display
export const SEVERITY_LABELS: Record<VacuumSeverity, string> = {
  error: 'Errors',
  warn: 'Warnings',
  info: 'Information',
  hint: 'Hints',
};

// Helper type for severity icons (VS Code ThemeIcons)
export const SEVERITY_ICONS: Record<VacuumSeverity, string> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  hint: 'lightbulb',
};
