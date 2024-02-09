import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
  } from 'vscode-languageclient/node';

export function activate(context: vscode.ExtensionContext) {

    let launcher = os.platform() === 'win32' ? 'vacuum' : 'vacuum';
    //let script = context.asAbsolutePath(path.join('node_modules', '@quobix/vacuum', 'bin', launcher));

    let ServerOptions: ServerOptions = {
        run: {command: launcher, args:['language-server']},
        debug: {command: launcher, args:['language-server']}
    };
    let clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'yaml' }, { scheme: 'file', language: 'json' }],
    };

    let lspClient: LanguageClient;

	let lint = vscode.commands.registerCommand('vacuum.lint', () => {
        lspClient = new LanguageClient("vacuum", ServerOptions, clientOptions);
        lspClient.start();
		vscode.window.showInformationMessage('vacuum is now active and linting your yaml/json files.');
      
	});

    let stopLint = vscode.commands.registerCommand('vacuum.stopLint', () => {
        lspClient.stop();
		vscode.window.showInformationMessage('vacuum has stopped linting your yaml/json files.');
      
	});

	context.subscriptions.push(lint, stopLint);
}

export function deactivate() {}
