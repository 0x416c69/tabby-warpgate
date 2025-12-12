# Tabby Warpgate Plugin

A comprehensive Warpgate SSH gateway integration for [Tabby Terminal](https://tabby.sh/). Connect to SSH hosts through Warpgate with one click - similar to Termius but integrated directly into Tabby.

## Features

- **Multiple Warpgate Server Support** - Connect to multiple Warpgate instances simultaneously
- **One-Click SSH Connections** - Connect to any Warpgate target with a single click
- **SFTP Integration** - Open SFTP file browser for any SSH target
- **Automatic Authentication** - Authenticate once, connect to all targets
- **Host Grouping & Search** - Organize and find hosts quickly
- **Auto-Refresh** - Keep host lists up to date automatically
- **Toolbar Quick Access** - Fast access to all hosts via toolbar button
- **Full Settings UI** - Easy configuration through Tabby settings
- **Cross-Platform** - Works on Tabby Desktop (Windows, macOS, Linux) and Tabby Web

## Installation

### From Plugin Manager

1. Open Tabby
2. Go to Settings > Plugins
3. Search for "warpgate"
4. Click Install

### Manual Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run build`
4. Copy the `dist` folder to your Tabby plugins directory:
   - **Windows**: `%APPDATA%\tabby\plugins\tabby-warpgate`
   - **macOS**: `~/Library/Application Support/tabby/plugins/tabby-warpgate`
   - **Linux**: `~/.config/tabby/plugins/tabby-warpgate`

## Configuration

### Adding a Warpgate Server

1. Open Tabby Settings
2. Go to the "Warpgate" tab
3. Click "Add Server"
4. Enter your Warpgate server details:
   - **Server Name**: A friendly name for this server
   - **Server URL**: The HTTPS URL of your Warpgate server (e.g., `https://warpgate.example.com`)
   - **Username**: Your Warpgate username
   - **Password**: Your Warpgate password
   - **Trust Self-Signed**: Enable if your Warpgate uses a self-signed certificate
5. Click "Test Connection" to verify
6. Click "Add Server" to save

### Plugin Settings

- **Auto-refresh Interval**: How often to refresh the host list (disabled, 30s, 1m, 5m, 10m)
- **Show Offline Servers**: Show servers that are not connected
- **Group by Server**: Group hosts by their Warpgate server
- **Sort by**: Sort hosts by name, server, type, or group
- **Default SFTP Path**: Initial directory when opening SFTP sessions

## Usage

### Connecting to a Host

#### Via Toolbar Button
1. Click the Warpgate icon in the toolbar (door icon)
2. Select a host from the list
3. Choose SSH or SFTP

#### Via Host Panel
1. The Warpgate hosts panel shows all available hosts
2. Click on a host to connect via SSH
3. Click the SFTP button for file browser access

### Keyboard Shortcuts

You can configure keyboard shortcuts in Tabby Settings > Hotkeys:

- **Show Warpgate Hosts**: Open the host selector
- **Refresh Warpgate Hosts**: Refresh all host lists

## How It Works

### One-Click Authentication (Ticket-Based)

This plugin uses Warpgate's **ticket system** for truly one-click SSH/SFTP connections:

1. When you add a server, the plugin stores your credentials securely in Tabby's config
2. On startup, the plugin authenticates with all enabled servers via Warpgate's API
3. When you click to connect, the plugin:
   - Creates a **one-time ticket** for that specific target
   - Uses the ticket secret as the SSH username (`ticket-<secret>`)
   - **No password prompt!** The ticket authenticates you automatically
4. Tickets are cached and reused until they expire or are consumed

This means you only need to enter your Warpgate credentials once when setting up - all subsequent connections are instant!

### Traditional Fallback with Automatic OTP

If ticket creation fails (e.g., non-admin users), the plugin falls back to traditional authentication with automatic OTP support:

- Username format: `warpgate_user:target_name`
- Uses the stored password for authentication
- **Automatic OTP**: The plugin automatically generates and provides OTP codes during keyboard-interactive authentication

#### Automatic OTP Setup (Recommended)

The easiest way to set up OTP is to let the plugin do it automatically:

1. Go to Settings > Warpgate
2. Select your server and click **"Auto-Setup OTP"**
3. The plugin will:
   - Generate a secure TOTP secret
   - Register it with your Warpgate account via the self-service API
   - Store the secret locally for automatic code generation
4. Done! All SSH connections will now automatically provide OTP codes

**Note:** This uses Warpgate's self-service profile API (`/profile/credentials/otp`) - no admin access required!

#### Manual OTP Setup

If you already have OTP configured in Warpgate and want to use your existing secret:

1. Go to Settings > Warpgate
2. Edit your server configuration
3. Enter your **TOTP Secret** (the Base32 key from your authenticator app)
4. The plugin will now automatically generate OTP codes during SSH authentication

**Finding Your TOTP Secret:**
- When setting up 2FA in Warpgate, you're shown a QR code
- The QR code contains a `secret` parameter (Base32 string like `JBSWY3DPEHPK3PXP`)
- You can also export the secret from authenticator apps like Aegis, andOTP, or Google Authenticator

**Security Note:** The TOTP secret is stored in Tabby's configuration. Make sure your Tabby config is protected.

### SSH Connection

When you connect to a Warpgate target:

1. The plugin creates a fresh one-time ticket (if admin privileges available)
2. SSH connects to the Warpgate SSH port (default: 2222)
3. Username format: `ticket-<secret>` (one-click) or `warpgate_user:target_name` (fallback)
4. Warpgate proxies the connection to the actual target

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Run tests
npm test

# Run tests with coverage
npm test -- --coverage
```

### Project Structure

```
tabby-warpgate/
├── src/
│   ├── api/                 # Warpgate API client
│   ├── components/          # Angular components
│   ├── models/              # TypeScript interfaces
│   ├── providers/           # Tabby providers
│   ├── services/            # Angular services
│   ├── __mocks__/           # Test mocks
│   ├── __tests__/           # Unit tests
│   └── index.ts             # Plugin entry point
├── package.json
├── tsconfig.json
├── webpack.config.js
└── jest.config.js
```

### Testing Your Plugin

Run Tabby with your plugin in development:

```bash
# Linux/macOS
TABBY_PLUGINS=$(pwd) tabby --debug

# Windows PowerShell
$env:TABBY_PLUGINS = Get-Location; tabby --debug
```

## Warpgate Configuration

Make sure your Warpgate server is properly configured:

1. SSH protocol must be enabled on Warpgate
2. Users must have appropriate roles to access targets
3. Targets must be configured with SSH credentials
4. **For One-Click Access**: Users need ticket creation permissions (typically admin role)

### Permissions for One-Click SSH

To enable one-click SSH without password prompts, your Warpgate user needs permission to create tickets. By default, this requires admin access. If your user doesn't have ticket permissions:

- The plugin will automatically fall back to password authentication
- You'll see a notification: "Could not create ticket, using password authentication"
- SSH will still work, but may prompt for password depending on Warpgate's auth config

Example Warpgate target configuration:

```yaml
targets:
  - name: production-server
    allow_roles:
      - admin
      - developers
    ssh:
      host: 192.168.1.100
      port: 22
      username: deploy
      auth:
        type: password
        password: "secret"
```

## Troubleshooting

### Connection Issues

1. **"Connection refused"**: Check that Warpgate is running and accessible
2. **"Authentication failed"**: Verify username and password
3. **"No targets available"**: Ensure your user has roles assigned to targets
4. **"Self-signed certificate error"**: Enable "Trust Self-Signed" option

### Plugin Not Loading

1. Check Tabby's plugin directory for the correct structure
2. Look for errors in Tabby's developer console (Ctrl+Shift+I)
3. Ensure all peer dependencies are met

### SSH Connection Fails

1. Verify Warpgate SSH port (default: 2222)
2. Check firewall settings
3. Ensure target host is reachable from Warpgate

## API Reference

The plugin exports several classes that can be used by other plugins:

```typescript
import {
  WarpgateService,
  WarpgateApiClient,
  WarpgateProfileProvider,
  WarpgateServerConfig,
  WarpgateTarget,
} from 'tabby-warpgate';
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Credits

- [Tabby Terminal](https://tabby.sh/) - The amazing terminal emulator
- [Warpgate](https://github.com/warp-tech/warpgate) - Smart SSH bastion host

## Support

- [GitHub Issues](https://github.com/arsacia/tabby-warpgate/issues)
- [Tabby Discord](https://discord.gg/tabby)
