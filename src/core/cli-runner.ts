/**
 * CLI Runner for vacuum
 * Spawns the vacuum CLI and parses JSON output
 */

import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import type { VacuumReport } from './types';

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

// Platform-aware launcher
const VACUUM_COMMAND = os.platform() === 'win32' ? 'vacuum.cmd' : 'vacuum';

export interface RunnerOptions {
  /** Custom ruleset file path */
  rulesetPath?: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Cancellation token */
  cancellationToken?: vscode.CancellationToken;
  /** Live document content (if provided, uses stdin instead of file) */
  content?: string;
}

export interface RunnerResult {
  success: boolean;
  report?: VacuumReport;
  error?: string;
}

/**
 * Run vacuum report command and parse JSON output
 * @param filePath Path to the OpenAPI spec file (used for context, or as actual file if no content provided)
 * @param options Runner options
 */
export async function runVacuumReport(
  filePath: string,
  options: RunnerOptions = {}
): Promise<RunnerResult> {
  const { rulesetPath, timeout = 60000, cancellationToken, content } = options;

  // Determine file extension from original path
  const ext = path.extname(filePath) || '.yaml';
  let targetFile = filePath;
  let tempFile: string | null = null;

  try {
    // Check for cancellation before starting
    if (cancellationToken?.isCancellationRequested) {
      return { success: false, error: 'Operation cancelled' };
    }

    // If content is provided, write to a temp file
    if (content !== undefined) {
      tempFile = path.join(os.tmpdir(), `vacuum-live-${Date.now()}${ext}`);
      await writeFileAsync(tempFile, content, 'utf8');
      targetFile = tempFile;
      console.log('[vacuum] Wrote live content to temp file:', tempFile, 'length:', content.length);
    }

    // Build command arguments
    const args = ['report', '-o'];

    if (rulesetPath) {
      args.push('-r', rulesetPath);
    }

    args.push(targetFile);

    console.log('[vacuum] Running CLI with args:', args.join(' '));
    const result = await runCommand(args, timeout, cancellationToken);

    // Check for cancellation after execution
    if (cancellationToken?.isCancellationRequested) {
      return { success: false, error: 'Operation cancelled' };
    }

    if (result.error) {
      console.log('[vacuum] CLI error:', result.error);
      return { success: false, error: result.error };
    }

    // Log output for debugging
    console.log('[vacuum] CLI stdout length:', result.stdout.length);
    if (result.stdout.length < 500) {
      console.log('[vacuum] CLI stdout:', result.stdout);
    }

    // Parse JSON output
    const report = JSON.parse(result.stdout) as VacuumReport;

    return { success: true, report };
  } catch (error) {
    // Handle specific error cases
    if (error instanceof Error) {
      // Command not found
      if (error.message.includes('ENOENT') || error.message.includes('not found')) {
        return {
          success: false,
          error: 'vacuum CLI not found. Please install vacuum: https://quobix.com/vacuum/',
        };
      }

      // Timeout
      if (error.message.includes('ETIMEDOUT') || error.message.includes('timed out')) {
        return {
          success: false,
          error: `vacuum timed out after ${timeout}ms. Try increasing the timeout for large specs.`,
        };
      }

      // JSON parse error (shouldn't happen with valid vacuum output)
      if (error instanceof SyntaxError) {
        return {
          success: false,
          error: 'Failed to parse vacuum output. The file may not be a valid OpenAPI specification.',
        };
      }

      // Generic error
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: 'Unknown error occurred while running vacuum',
    };
  } finally {
    // Clean up temp file
    if (tempFile) {
      try {
        await unlinkAsync(tempFile);
        console.log('[vacuum] Cleaned up temp file');
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Run vacuum command
 */
function runCommand(
  args: string[],
  timeout: number,
  cancellationToken?: vscode.CancellationToken
): Promise<{ stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(VACUUM_COMMAND, args, {
      timeout,
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Handle cancellation
    if (cancellationToken) {
      cancellationToken.onCancellationRequested(() => {
        killed = true;
        proc.kill();
        resolve({ stdout: '', stderr: '', error: 'Operation cancelled' });
      });
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      if (!killed) {
        resolve({ stdout: '', stderr: '', error: error.message });
      }
    });

    proc.on('close', (code) => {
      if (killed) return;

      if (stderr) {
        console.warn('[vacuum] CLI stderr:', stderr);
      }

      if (code !== 0 && !stdout) {
        resolve({ stdout: '', stderr, error: stderr || `Process exited with code ${code}` });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Check if vacuum CLI is available
 */
export async function isVacuumAvailable(): Promise<boolean> {
  try {
    await execAsync(`${VACUUM_COMMAND} version`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get vacuum version string
 */
export async function getVacuumVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${VACUUM_COMMAND} version`, { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}
