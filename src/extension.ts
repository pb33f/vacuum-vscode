import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';
import {
	buildLanguageServerExecutable,
	type ResolvedExecutable,
} from './executable';

const configSection = 'vacuum';
const enabledSetting = 'languageServer.enabled';
const executablePathSetting = 'executablePath';
const rulesetSetting = 'ruleset';
const ignoreFileSetting = 'ignoreFile';
const isWindows = os.platform() === 'win32';

let lspClient: LanguageClient | undefined;

interface ConfigurationUpdateScope {
	target: vscode.ConfigurationTarget;
	overrideInLanguage: boolean;
}

export function activate(context: vscode.ExtensionContext) {
	const lint = vscode.commands.registerCommand('vacuum.lint', async () => {
		await setLanguageServerEnabled(true);
		await startLanguageServer(true);
	});

	const stopLint = vscode.commands.registerCommand('vacuum.stopLint', async () => {
		await setLanguageServerEnabled(false);
		await stopLanguageServer();
		vscode.window.showInformationMessage('vacuum has stopped linting your yaml/json files.');
	});
	const selectRuleset = vscode.commands.registerCommand('vacuum.selectRuleset', async () => {
		await selectWorkspaceFileSetting(rulesetSetting, 'Select vacuum ruleset');
	});
	const clearRuleset = vscode.commands.registerCommand('vacuum.clearRuleset', async () => {
		await clearWorkspaceSetting(rulesetSetting);
		vscode.window.showInformationMessage('vacuum ruleset setting cleared.');
	});
	const selectIgnoreFile = vscode.commands.registerCommand('vacuum.selectIgnoreFile', async () => {
		await selectWorkspaceFileSetting(ignoreFileSetting, 'Select vacuum ignore file');
	});
	const clearIgnoreFile = vscode.commands.registerCommand('vacuum.clearIgnoreFile', async () => {
		await clearWorkspaceSetting(ignoreFileSetting);
		vscode.window.showInformationMessage('vacuum ignore file setting cleared.');
	});

	const configWatcher = vscode.workspace.onDidChangeConfiguration(async (event) => {
		if (!event.affectsConfiguration(`${configSection}.${enabledSetting}`) &&
			!event.affectsConfiguration(`${configSection}.${executablePathSetting}`)) {
			return;
		}

		await stopLanguageServer();
		if (isLanguageServerEnabled()) {
			await startLanguageServer(false);
		}
	});

	context.subscriptions.push(lint, stopLint, selectRuleset, clearRuleset, selectIgnoreFile, clearIgnoreFile, configWatcher);

	if (isLanguageServerEnabled()) {
		void startLanguageServer(false);
	}
}

export async function deactivate() {
	await stopLanguageServer();
}

async function startLanguageServer(showReadyMessage: boolean): Promise<void> {
	if (lspClient) {
		if (showReadyMessage) {
			vscode.window.showInformationMessage('vacuum is already linting your yaml/json files.');
		}
		return;
	}

	const executable = resolveVacuumExecutable();
	if (!executable) {
		await showMissingExecutableMessage();
		return;
	}

	const serverOptions: ServerOptions = {
		run: executable,
		debug: executable,
	};
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'yaml' }, { scheme: 'file', language: 'json' }],
	};

	const client = new LanguageClient('vacuum', 'vacuum', serverOptions, clientOptions);
	lspClient = client;

	try {
		client.start();
		await client.onReady();
		if (showReadyMessage) {
			vscode.window.showInformationMessage('vacuum is now active and linting your yaml/json files.');
		}
	} catch (error) {
		if (lspClient === client) {
			lspClient = undefined;
		}
		await showStartFailureMessage(error);
	}
}

async function stopLanguageServer(): Promise<void> {
	if (!lspClient) {
		return;
	}

	const client = lspClient;
	lspClient = undefined;
	await client.stop();
}

async function setLanguageServerEnabled(enabled: boolean): Promise<void> {
	const configuration = getVacuumConfiguration();
	const updateScope = getLanguageServerEnabledUpdateScope(configuration);
	await configuration.update(enabledSetting, enabled, updateScope.target, updateScope.overrideInLanguage);
}

function isLanguageServerEnabled(): boolean {
	return getVacuumConfiguration().get<boolean>(enabledSetting, true);
}

function getConfiguredExecutablePath(): string {
	return getVacuumConfiguration().get<string>(executablePathSetting, '').trim();
}

function getVacuumConfiguration(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(configSection, getConfigurationScope());
}

function getConfigurationScope(): vscode.ConfigurationScope | undefined {
	return vscode.window.activeTextEditor?.document ?? vscode.workspace.workspaceFolders?.[0];
}

async function selectWorkspaceFileSetting(setting: string, title: string): Promise<void> {
	const workspaceFolder = await resolveWorkspaceFolderForUpdate();
	if (workspaceFolder === null) {
		return;
	}
	const defaultUri = workspaceFolder?.uri;
	const selection = await vscode.window.showOpenDialog({
		title,
		defaultUri,
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		openLabel: 'Select',
		filters: {
			'YAML, JSON': ['yaml', 'yml', 'json'],
			'All Files': ['*'],
		},
	});

	if (!selection || selection.length === 0) {
		return;
	}

	await updateWorkspaceSetting(setting, valueForWorkspaceSetting(selection[0], workspaceFolder), workspaceFolder);
	vscode.window.showInformationMessage(`vacuum ${setting} setting updated.`);
}

async function updateWorkspaceSetting(
	setting: string,
	value: string | undefined,
	workspaceFolder?: vscode.WorkspaceFolder
): Promise<void> {
	const configuration = vscode.workspace.getConfiguration(configSection, workspaceFolder);
	const target = workspaceFolder
		? vscode.ConfigurationTarget.WorkspaceFolder
		: vscode.ConfigurationTarget.Global;

	await configuration.update(setting, value, target);
}

async function clearWorkspaceSetting(setting: string): Promise<void> {
	const workspaceFolder = await resolveWorkspaceFolderForUpdate();
	if (workspaceFolder === null) {
		return;
	}
	await updateWorkspaceSetting(setting, undefined, workspaceFolder);
}

async function resolveWorkspaceFolderForUpdate(): Promise<vscode.WorkspaceFolder | undefined | null> {
	const activeResource = vscode.window.activeTextEditor?.document.uri;
	if (activeResource) {
		const activeFolder = vscode.workspace.getWorkspaceFolder(activeResource);
		if (activeFolder) {
			return activeFolder;
		}
	}

	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	if (workspaceFolders.length <= 1) {
		return workspaceFolders[0];
	}

	const selection = await vscode.window.showQuickPick(
		workspaceFolders.map((folder) => ({ label: folder.name, folder })),
		{ placeHolder: 'Select the workspace folder for the vacuum setting' }
	);
	return selection?.folder ?? null;
}

function valueForWorkspaceSetting(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder | undefined): string {
	if (uri.scheme !== 'file') {
		return uri.toString();
	}

	if (!workspaceFolder || workspaceFolder.uri.scheme !== 'file') {
		return uri.fsPath;
	}

	const relative = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
	if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
		return relative.split(path.sep).join('/');
	}

	return uri.fsPath;
}

function getLanguageServerEnabledUpdateScope(configuration: vscode.WorkspaceConfiguration): ConfigurationUpdateScope {
	const inspected = configuration.inspect<boolean>(enabledSetting);

	if (inspected?.workspaceFolderLanguageValue !== undefined) {
		return { target: vscode.ConfigurationTarget.WorkspaceFolder, overrideInLanguage: true };
	}
	if (inspected?.workspaceLanguageValue !== undefined) {
		return { target: vscode.ConfigurationTarget.Workspace, overrideInLanguage: true };
	}
	if (inspected?.globalLanguageValue !== undefined) {
		return { target: vscode.ConfigurationTarget.Global, overrideInLanguage: true };
	}
	if (inspected?.defaultLanguageValue !== undefined) {
		return { target: vscode.ConfigurationTarget.Global, overrideInLanguage: true };
	}
	if (inspected?.workspaceFolderValue !== undefined) {
		return { target: vscode.ConfigurationTarget.WorkspaceFolder, overrideInLanguage: false };
	}
	if (inspected?.workspaceValue !== undefined) {
		return { target: vscode.ConfigurationTarget.Workspace, overrideInLanguage: false };
	}

	return { target: vscode.ConfigurationTarget.Global, overrideInLanguage: false };
}

function resolveVacuumExecutable(): ResolvedExecutable | undefined {
	const configuredPath = getConfiguredExecutablePath();
	if (configuredPath) {
		return resolveConfiguredExecutable(configuredPath);
	}

	return findOnPath('vacuum') ?? findCommonExecutable();
}

function resolveConfiguredExecutable(configuredPath: string): ResolvedExecutable | undefined {
	const expandedPath = expandPath(configuredPath);
	if (!expandedPath) {
		return undefined;
	}

	if (hasPathSeparator(expandedPath) || path.isAbsolute(expandedPath)) {
		if (isDirectory(expandedPath)) {
			return findFirstExistingExecutable(candidatePathsForDirectory(expandedPath));
		}
		return fileExists(expandedPath) ? toResolvedExecutable(expandedPath) : undefined;
	}

	return findOnPath(expandedPath);
}

function findOnPath(commandName: string): ResolvedExecutable | undefined {
	const pathValue = process.env.PATH ?? '';
	const executableNames = executableNamesFor(commandName);

	for (const directory of pathValue.split(path.delimiter)) {
		if (!directory) {
			continue;
		}

		const executable = findFirstExistingExecutable(executableNames.map((name) => path.join(directory, name)));
		if (executable) {
			return executable;
		}
	}

	return undefined;
}

function findCommonExecutable(): ResolvedExecutable | undefined {
	if (isWindows) {
		const npmDirectory = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : undefined;
		return findFirstExistingExecutable([
			...(npmDirectory ? candidatePathsForDirectory(npmDirectory) : []),
			...candidatePathsForDirectory(path.join(os.homedir(), 'AppData', 'Roaming', 'npm')),
			...candidatePathsForDirectory(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs')),
		]);
	}

	return findFirstExistingExecutable([
		'/opt/homebrew/bin/vacuum',
		'/usr/local/bin/vacuum',
		'/usr/bin/vacuum',
		path.join(os.homedir(), '.local', 'bin', 'vacuum'),
		path.join(os.homedir(), '.npm-global', 'bin', 'vacuum'),
	]);
}

function executableNamesFor(commandName: string): string[] {
	if (!isWindows) {
		return [commandName];
	}

	const extension = path.extname(commandName);
	if (extension) {
		return [commandName];
	}

	return ['.exe', '.cmd', '.bat', ''].map((suffix) => `${commandName}${suffix}`);
}

function candidatePathsForDirectory(directory: string): string[] {
	return executableNamesFor('vacuum').map((name) => path.join(directory, name));
}

function findFirstExistingExecutable(candidates: string[]): ResolvedExecutable | undefined {
	for (const candidate of candidates) {
		if (fileExists(candidate)) {
			return toResolvedExecutable(candidate);
		}
	}
	return undefined;
}

function toResolvedExecutable(command: string): ResolvedExecutable {
	return buildLanguageServerExecutable(command);
}

function expandPath(value: string): string {
	let expanded = value.trim();
	if ((expanded.startsWith('"') && expanded.endsWith('"')) ||
		(expanded.startsWith("'") && expanded.endsWith("'"))) {
		expanded = expanded.slice(1, -1);
	}

	if (expanded === '~') {
		return os.homedir();
	}

	if (expanded.startsWith(`~${path.sep}`) || expanded.startsWith('~/') || expanded.startsWith('~\\')) {
		expanded = path.join(os.homedir(), expanded.slice(2));
	}

	expanded = expanded.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
	expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => process.env[name] ?? '');

	if (isWindows) {
		expanded = expanded.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? '');
	}

	return expanded;
}

function hasPathSeparator(value: string): boolean {
	return value.includes('/') || value.includes('\\');
}

function fileExists(filePath: string): boolean {
	try {
		const stats = fs.statSync(filePath);
		if (!stats.isFile()) {
			return false;
		}

		if (isWindows) {
			return true;
		}

		fs.accessSync(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function isDirectory(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}

async function showMissingExecutableMessage(): Promise<void> {
	const configuredPath = getConfiguredExecutablePath();
	const message = configuredPath
		? `vacuum could not be found at "${configuredPath}".`
		: 'vacuum could not be found on PATH.';

	const selection = await vscode.window.showErrorMessage(
		`${message} Install vacuum or set vacuum.executablePath.`,
		'Open Settings',
		'Installation Docs'
	);

	if (selection === 'Open Settings') {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'vacuum.executablePath');
	}
	if (selection === 'Installation Docs') {
		await vscode.env.openExternal(vscode.Uri.parse('https://quobix.com/vacuum/installing'));
	}
}

async function showStartFailureMessage(error: unknown): Promise<void> {
	const detail = error instanceof Error ? error.message : String(error);
	const selection = await vscode.window.showErrorMessage(
		`vacuum failed to start. ${detail}`,
		'Open Settings',
		'Installation Docs'
	);

	if (selection === 'Open Settings') {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'vacuum.executablePath');
	}
	if (selection === 'Installation Docs') {
		await vscode.env.openExternal(vscode.Uri.parse('https://quobix.com/vacuum/installing'));
	}
}
