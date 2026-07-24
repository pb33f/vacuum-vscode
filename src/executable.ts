import * as path from 'path';

const windowsCommandMetaCharacters = /([()\][%!^"`<>&|;, *?])/g;

export interface ResolvedExecutable {
	command: string;
	args: string[];
	options?: {
		shell: boolean;
		windowsVerbatimArguments: boolean;
	};
}

// buildLanguageServerExecutable returns a spawn-safe command for the vacuum
// language server. Windows command shims must run through cmd.exe with arguments
// passed verbatim; otherwise Node escapes the quotes and cmd.exe treats them as
// literal characters.
export function buildLanguageServerExecutable(
	command: string,
	platform: NodeJS.Platform = process.platform,
	commandShell: string | undefined = process.env.ComSpec
): ResolvedExecutable {
	const extension = platform === 'win32'
		? path.win32.extname(command).toLowerCase()
		: path.extname(command).toLowerCase();

	if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
		const shellCommand = `${escapeWindowsCommand(command)} language-server`;
		return {
			command: commandShell ?? 'cmd.exe',
			args: ['/d', '/s', '/c', `"${shellCommand}"`],
			options: {
				shell: false,
				windowsVerbatimArguments: true,
			},
		};
	}

	return { command, args: ['language-server'] };
}

function escapeWindowsCommand(command: string): string {
	return command.replace(windowsCommandMetaCharacters, '^$1');
}
