# Contributing to Tabby Warpgate

Thanks for helping out! Bug reports, feature ideas, docs and code are all welcome.

## Reporting bugs and asking for features

- Search the [existing issues](https://github.com/0x416c69/tabby-warpgate/issues) first
- Use the bug report or feature request template
- For bugs, include your Tabby, Warpgate and plugin versions, your OS, and the errors from the developer console (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>) with **Debug logging** enabled in Settings → Warpgate. Remove hostnames and usernames you don't want to share

## Development setup

Requirements: Node.js 18+ and npm.

```bash
git clone https://github.com/0x416c69/tabby-warpgate.git
cd tabby-warpgate
npm install
npm run watch     # rebuild on change
```

Start Tabby with your local build:

```bash
# Linux / macOS (from the plugin folder)
TABBY_PLUGINS=$(dirname $(pwd)) tabby --debug

# Windows PowerShell
$env:TABBY_PLUGINS = (Get-Item .).Parent.FullName; tabby --debug
```

A local Warpgate instance is the easiest way to test real connections. See the [Warpgate docs](https://github.com/warp-tech/warpgate) for setup.

## Project layout

```
src/
├── api/          # Warpgate HTTP API client
├── components/   # Angular components (hosts panel, editors, settings)
├── models/       # TypeScript interfaces and defaults
├── providers/    # Tabby providers (config, hotkeys, SSH tab handler, tab recovery)
├── services/     # Servers, profiles, connections, host settings, snippets, history
├── utils/        # TOTP, profile IDs, prompt detection, helpers
├── __tests__/    # Unit tests
└── index.ts      # Plugin entry point
```

## Before opening a pull request

```bash
npm run lint
npm test
npm run build
```

- Keep pull requests focused on one change
- Add or update tests for behavior changes (see [TESTING.md](TESTING.md))
- Update the README when you add or change a user-facing feature
- UI changes should work in dark and light Tabby themes; screenshots in the PR help a lot

## Becoming a maintainer

We're looking for co-maintainers who use Warpgate day to day. If you've contributed a few changes and want to help with reviews, triage and releases, open an issue or mention it in a pull request.
