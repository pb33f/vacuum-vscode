import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildLanguageServerExecutable } from '../executable';

test('builds a verbatim cmd.exe invocation for an npm command shim', () => {
	const executable = buildLanguageServerExecutable(
		'C:\\Users\\erwin\\AppData\\Roaming\\npm\\vacuum.cmd',
		'win32',
		'C:\\Windows\\System32\\cmd.exe'
	);

	assert.deepEqual(executable, {
		command: 'C:\\Windows\\System32\\cmd.exe',
		args: [
			'/d',
			'/s',
			'/c',
			'"C:\\Users\\erwin\\AppData\\Roaming\\npm\\vacuum.cmd language-server"',
		],
		options: {
			shell: false,
			windowsVerbatimArguments: true,
		},
	});
});

test('builds the same cmd.exe invocation for batch shims', () => {
	const executable = buildLanguageServerExecutable(
		'C:\\Tools\\vacuum.BAT',
		'win32',
		'cmd.exe'
	);

	assert.deepEqual(executable, {
		command: 'cmd.exe',
		args: ['/d', '/s', '/c', '"C:\\Tools\\vacuum.BAT language-server"'],
		options: {
			shell: false,
			windowsVerbatimArguments: true,
		},
	});
});

test('escapes spaces and command metacharacters in a Windows shim path', () => {
	const executable = buildLanguageServerExecutable(
		'C:\\Program Files\\PB33F & Co\\vacuum.cmd',
		'win32'
	);

	assert.equal(
		executable.args[3],
		'"C:\\Program^ Files\\PB33F^ ^&^ Co\\vacuum.cmd language-server"'
	);
});

test('runs Windows executables directly', () => {
	assert.deepEqual(
		buildLanguageServerExecutable('C:\\Tools\\vacuum.exe', 'win32'),
		{
			command: 'C:\\Tools\\vacuum.exe',
			args: ['language-server'],
		}
	);
});

test('runs non-Windows executables directly', () => {
	assert.deepEqual(
		buildLanguageServerExecutable('/usr/local/bin/vacuum', 'darwin'),
		{
			command: '/usr/local/bin/vacuum',
			args: ['language-server'],
		}
	);
});

test('launches a Windows command shim from a path containing spaces', {
	skip: process.platform !== 'win32',
}, async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'vacuum launcher '));
	const shim = path.join(directory, 'vacuum.cmd');

	try {
		await writeFile(
			shim,
			'@echo off\r\nif not "%~1"=="language-server" exit /b 2\r\necho vacuum-lsp-started\r\nexit /b 0\r\n'
		);

		const executable = buildLanguageServerExecutable(shim);
		const result = await run(executable);

		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /vacuum-lsp-started/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

async function run(executable: ReturnType<typeof buildLanguageServerExecutable>): Promise<{
	code: number | null;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable.command, executable.args, executable.options);
		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, stdout, stderr }));
	});
}
