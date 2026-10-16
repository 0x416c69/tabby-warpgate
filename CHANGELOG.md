# Changelog

## 1.1.1

### Fixed

- Installing from Tabby's plugin manager failed on Windows with "[object Object]". Tabby's own packages (tabby-core, tabby-ssh, Angular, ...) are now optional peer dependencies, so the installer no longer downloads them and no longer runs tabby-ssh's install script (#3, thanks @etnperlong)

## 1.1.0

A big update that turns the plugin into a full host manager for Warpgate.

### New

- **OS detection**: hosts show their operating system logo and version (Ubuntu, Debian, Red Hat, Alpine, macOS, Windows and more), detected on a separate channel after connecting
- **Host customization**: aliases, tags, notes and colors per host, searchable from anywhere
- **Snippets**: a library of commands you can run in one session, in all open sessions, or on hosts you pick; startup snippets run when you connect
- **SSH options**: port forwarding (local, remote, dynamic) per host; agent forwarding, X11 and keepalive per server, overridable per host
- **Connection history** with a "Jump back in" row and pinned hosts
- **Quick connect from anywhere** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>), run a snippet in the current terminal (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd>), open the hosts tab (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>)
- **Open several hosts at once** as tabs or as a split grid
- **Authentication modes**: automatic (tickets with password fallback), tickets only, password only
- **One-click OTP setup** and removal for your Warpgate account
- Redesigned hosts panel and settings that follow your Tabby color scheme
- The hosts tab is restored when Tabby restarts

### Fixed

- SSH connections used the web UI port from the server URL; the SSH port now comes from Warpgate (#1)
- Every connection gets its own one-time ticket, including reconnects, split, duplicated and restored tabs
- Logging in again automatically when the Warpgate web session expires, including two-factor logins
- Password and OTP prompts answered reliably when tickets are not available
- Screens in Tabby not updating after network requests
- Host settings not applied in split and duplicated tabs
- Clear error messages for missing permissions and ticket-only mode

Tested with Tabby 1.0.238 and Warpgate 0.29.2.
