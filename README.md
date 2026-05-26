# vacuum OpenAPI linter for VSCode    

![logo](https://quobix.com/images/vacuum/logo.png)

## The world's fastest OpenAPI linter

This is a VSCode extension that allows you to use the world's fastest OpenAPI linter inside VSCode.

## Install vacuum

If you don't have vacuum installed, make sure you do that first **_(requires `v0.9.1` or later)._**

> `vacuum` does not come bundled with the plugin.

```bash
npm install -g @quobix/vacuum
```

Or via yarn using `yarn global add @quobix/vacuum`

You can also use homebrew to install vacuum on MacOS X

```bash
brew install daveshanley/vacuum/vacuum
```
[See more installation options](https://quobix.com/vacuum/installing).

---

### Enabling vacuum

vacuum starts automatically when you open YAML or JSON files.

You can also open up the command palette and type `vacuum` and select `Lint OpenAPI using vacuum`.

YAML and JSON files will be automatically detected (if they are OpenAPI) and linted using vacuum.

### Disabling vacuum

If you want to disable vacuum, open up the command palette and type `vacuum` and select `Stop Linting OpenAPI using vacuum`.

### Executable path

The extension uses the `vacuum` executable installed on your machine. If VSCode cannot find `vacuum` on `PATH`, set `vacuum.executablePath` to the full path of the executable.

### Configuration

To configure vacuum to use your own rules, rulesets and custom functions, you can 
[provide a configuration file](https://quobix.com/vacuum/configuring).

You can also configure the extension from VS Code:

1. Open the command palette.
2. Run `Select vacuum Ruleset` or `Select vacuum Ignore File`.
3. Pick the ruleset or ignore file to save it into the workspace settings.

The extension supports these workspace settings:

```json
{
  "vacuum.ruleset": "path/to/ruleset.yaml",
  "vacuum.ignoreFile": "path/to/ignore.yaml",
  "vacuum.functions": "path/to/functions",
  "vacuum.base": "path/to/api/root",
  "vacuum.remote": true,
  "vacuum.skipCheck": false,
  "vacuum.timeout": 5,
  "vacuum.lookupTimeout": 500,
  "vacuum.hardMode": false,
  "vacuum.extensionRefs": false
}
```

Configuration changes are sent to the running language server and open documents are linted again automatically.

### Documentation

Learn more about vacuum by visiting the [vacuum documentation](https://quobix.com/vacuum/).

[vacuum documentation](https://quobix.com/vacuum/)
[vacuum online demo](https://quobix.com/vacuum/demo)

