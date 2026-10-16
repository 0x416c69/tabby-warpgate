# Comprehensive Test Coverage

## Overview

This document describes the comprehensive testing strategy implemented to catch bugs before they reach production.

## Test Files

### 1. **Integration Tests** ([warpgate.integration.spec.ts](src/__tests__/warpgate.integration.spec.ts))

These tests simulate real-world scenarios with mocked HTTP responses to verify the complete authentication and session management flows.

#### Test Coverage:

**Server Config Persistence (15 tests)**
- Adding servers and persisting to config proxy
- Updating servers and persisting changes
- Removing servers and persisting deletion
- Multiple server operations without data loss
- Concurrent server additions
- Rapid add/update/remove operations

**Authentication Flow with OTP (4 tests)**
- Successful login without OTP
- Detecting when OTP is required
- Successfully authenticating with OTP code
- Handling incorrect OTP code

**Session Reuse (2 tests)**
- Preserving test connection session and reusing when adding server
- Cleanup of test sessions after timeout

**OTP Secret Management (2 tests)**
- Auto-generating OTP when secret is configured
- Validating OTP secret format

**Error Handling (3 tests)**
- Network errors
- Malformed server responses
- Config store initialization failures

**Memory Management (1 test)**
- Cleanup of test clients on destroy

### 2. **Config Proxy Tests** ([config-proxy.spec.ts](src/__tests__/config-proxy.spec.ts))

These tests specifically verify that the service correctly handles Tabby's proxy-based config store, which was the source of the critical "servers disappearing" bugs.

#### Test Coverage:

**Array Modification Tests (5 tests)**
- Adding server by pushing to proxy array
- Updating server by modifying proxy array element
- Removing server using splice on proxy array
- NOT losing servers when updating one server
- Handling rapid sequential updates without data loss

**Regression Tests for Specific Bugs (3 tests)**
- BUG FIX: Not clearing servers array on saveConfig
- BUG FIX: Preserving servers when updating lastConnected
- BUG FIX: Not losing servers when adding a new one

**Edge Cases (4 tests)**
- Handling empty servers array
- Updating non-existent server
- Removing non-existent server
- Concurrent add operations

**Config Save Calls (3 tests)**
- Calling config.save() after addServer
- Calling config.save() after updateServer
- Calling config.save() after removeServer

### 3. **Unit Tests** ([warpgate.service.spec.ts](src/__tests__/warpgate.service.spec.ts))

Basic unit tests for individual methods (40+ tests).

### 4. **API Client Tests** ([warpgate.api.spec.ts](src/__tests__/warpgate.api.spec.ts))

Comprehensive tests for the WarpgateApiClient covering all HTTP endpoints, error handling, and edge cases (80+ tests).

### 5. **Service Regression Tests** ([service-regressions.spec.ts](src/__tests__/service-regressions.spec.ts))

Connection, ticket and configuration behavior of `WarpgateService`:

- Logins only count as connected when Warpgate accepts them (rejected passwords, unsupported second factors, failed OTP)
- Valid web sessions are reused, expired ones trigger a new login and the request is retried (targets, tickets)
- The SSH port comes from the server info, never from the HTTP URL; `external_host` and IPv6 handling
- One-time tickets: expiry, never reused in connection details, claimed exactly once, ticket-only mode, permission errors
- Ticket cleanup removes used and expired plugin tickets only
- Enabling, disabling, editing and removing servers updates hosts and sessions
- Config persistence of pinned hosts, view mode and the auto-refresh timer, waiting for Tabby's config to load
- Loading state with several servers, OTP prompt cancellation, OTP removal, manual OTP during "Test connection"

### 6. **Profile Provider Tests** ([warpgate-profile.service.spec.ts](src/__tests__/warpgate-profile.service.spec.ts))

Builtin and one-click profiles, host customization applied to profiles, ticket and password fallback,
profile descriptions for Tabby's selector and delegation to Tabby's SSH provider.

### 7. **SSH Handler and Connection Tests** ([ssh-handler.spec.ts](src/__tests__/ssh-handler.spec.ts))

- Detecting Warpgate tabs by profile ID (Tabby's profile proxies hide plugin metadata), split panes added later
- Fresh credentials before every connection attempt: first connect, reconnect, duplicated and restored tabs
- Host settings and queued snippets applied to the connection, history recorded once per tab
- Keyboard-interactive answers per prompt (password and OTP), no repeated OTP codes, per-tab state
- Opening hosts as tabs or as a split grid, quick connect ordering (pinned, recent, others)

### 8. **Feature Tests** ([features.spec.ts](src/__tests__/features.spec.ts))

Host settings, snippets, connection history, profile IDs, prompt detection, target icons and colors,
host search ranking, split layout and hotkey defaults.

### 9. **OS Detection Tests** ([os-detection.spec.ts](src/__tests__/os-detection.spec.ts))

- Parsing `uname`, `/etc/os-release`, `sw_vers` and `ver` output (distributions, look-alikes, macOS, BSD, Windows)
- Running commands on a separate exec channel: output, timeout, refused requests
- When to detect (once a day per host, one at a time, setting off), stored results, icons and colors

## Key Testing Principles

### 1. **Proxy-Based Config Testing**

The tests create a proper Proxy that mimics Tabby's config.store behavior:

```typescript
function createTabbyConfigProxy() {
  const target = {
    warpgate: {
      ...DEFAULT_WARPGATE_CONFIG,
      servers: [] as WarpgateServerConfig[],
    }
  };

  return new Proxy(target, {
    get(obj, prop) {
      return obj[prop as keyof typeof obj];
    },
    set(obj, prop, value) {
      console.log(`[Config Proxy] Setting ${String(prop)}:`, value);
      obj[prop as keyof typeof obj] = value;
      return true;
    }
  });
}
```

This ensures tests catch issues with array manipulation on proxied objects.

### 2. **Mocked HTTP Responses**

Integration tests mock fetch responses to simulate various server scenarios:

```typescript
const mockLoginResponse = (state: string, methods?: string[]) => ({
  ok: true,
  status: state === 'Accepted' ? 201 : 401,
  headers: new Headers({
    'set-cookie': 'warpgate-http-session=test-session; HttpOnly; Path=/; Max-Age=86400'
  }),
  json: async () => ({
    state: {
      auth: {
        state,
        methods_remaining: methods || []
      }
    }
  })
});
```

### 3. **Regression Tests**

Every bug that was fixed now has a specific regression test to prevent it from happening again:

- **Server disappearing after update**: `should NOT lose servers when updating one server`
- **lastConnected update losing servers**: `should preserve servers when updating lastConnected`
- **Session waste**: `should preserve test connection session and reuse when adding server`

## Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testPathPattern="config-proxy"
npm test -- --testPathPattern="integration"

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch
```

## Test Coverage Goals

Coverage is collected for the API client, models, services, providers and utilities
(components are covered by their helper functions). Minimum thresholds are set in `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 40,
    functions: 40,
    lines: 40,
    statements: 40,
  },
}
```

Run `npm test` to see the current coverage report.

## Bugs Caught by New Tests

These tests would have caught all the bugs we encountered:

1. **✅ Servers disappearing after update** - Caught by config-proxy tests
2. **✅ Session waste on test connection** - Caught by integration tests
3. **✅ OTP prompt not working** - Would be caught by integration tests (mocked NgbModal)
4. **✅ Config array manipulation issues** - Caught by config-proxy tests

## End-to-End Testing with Warpgate and Tabby

Unit tests cannot catch everything that depends on Tabby's runtime (Angular zones, config proxies,
tab recovery), so test releases against a real Warpgate and a real Tabby. The last full run used
Warpgate 0.29.2 and Tabby 1.0.238 on Linux.

### 1. Start Warpgate

```bash
mkdir -p warpgate-data && chmod 777 warpgate-data
docker run --rm -v "$PWD/warpgate-data:/data" ghcr.io/warp-tech/warpgate \
  unattended-setup --data-path /data --http-port 8888 --ssh-port 2222 \
  --host-key-verification auto-accept --admin-password 'AdminPass123!'
# On hosts without IPv6, change the `listen: '[::]:…'` entries in warpgate-data/warpgate.yaml to 0.0.0.0
docker run -d --name warpgate --network host -v "$PWD/warpgate-data:/data" ghcr.io/warp-tech/warpgate run
```

In the web UI (`https://localhost:8888`), add one or more SSH targets (any SSH server works,
e.g. a local OpenSSH with password auth), assign them to roles, and create a second, non-admin
user with a password and a TOTP credential.

### 2. Run Tabby with the plugin

```bash
npm run build
TABBY_PLUGINS=$(dirname $(pwd)) tabby --debug
```

### 3. Checklist

| Area | What to check |
|------|---------------|
| Servers | Add a server with the URL on port 8888, test connection, OTP prompt for the 2FA user, enable/disable |
| Tickets | One-click connect as admin; SSH goes to port 2222; reconnect, split and duplicate get new tickets |
| Restore | Restart Tabby with split Warpgate tabs open: every pane connects with its own ticket |
| Fallback | Non-admin user: password login with the OTP prompt answered automatically, no ticket errors |
| Modes | "Password only" and "Tickets only" (clear error for users who cannot create tickets) |
| OTP | Set up OTP and Disable OTP from settings; restart Tabby to check login with the stored secret |
| Hosts | Alias, color, tags, notes, pinning, search, quick connect (Ctrl+Shift+K), Ctrl+Shift+H |
| OS detection | After connecting, the host shows its OS logo and version; nothing appears in the terminal |
| Automation | Startup snippet, snippet in one/all sessions, Ctrl+Shift+J, connect several hosts and run |
| Forwarding | Local port forward reaches its destination through Warpgate |
| Themes | Hosts panel in dark and light color schemes |

Warpgate logs every ticket, login and channel (`docker logs warpgate`), which makes it easy to
confirm what the plugin did.

## Future Improvements

1. Automate the end-to-end checklist above
2. Add performance tests for large numbers of servers and hosts
3. Add tests for network interruption scenarios

## Mock Files

- [angular-core.ts](src/__mocks__/angular-core.ts) - Angular core mocks
- [ng-bootstrap.ts](src/__mocks__/ng-bootstrap.ts) - NgBootstrap mocks
- [tabby-core.ts](src/__mocks__/tabby-core.ts) - Tabby core mocks
- [tabby-settings.ts](src/__mocks__/tabby-settings.ts) - Tabby settings mocks
- [tabby-ssh.ts](src/__mocks__/tabby-ssh.ts) - Tabby SSH mocks

## Continuous Integration

These tests should be run:
- Before every commit
- On every pull request
- Before every release
- In CI/CD pipeline

## Test-Driven Development

Going forward, for new features:
1. Write failing tests first
2. Implement the feature
3. Verify tests pass
4. Refactor with confidence

This ensures bugs are caught during development, not after deployment.
