/**
 * Shared design tokens and controls for the Warpgate UI
 *
 * Colors are derived from Tabby's theme variables (set from the active terminal
 * color scheme), so the UI follows dark, light and custom themes automatically.
 */

export const WARPGATE_THEME_STYLES = `
:host {
  --wg-bg: var(--theme-bg, var(--bs-body-bg, #14151a));
  --wg-fg: var(--theme-fg, var(--bs-body-color, #e8e8ee));
  --wg-accent: var(--theme-primary, var(--bs-primary, #7c6cff));
  --wg-accent-2: color-mix(in oklab, var(--wg-accent) 55%, #e649c8);
  --wg-accent-fg: #ffffff;
  --wg-gradient: linear-gradient(135deg, var(--wg-accent) 0%, var(--wg-accent-2) 100%);
  --wg-surface: color-mix(in srgb, var(--wg-fg) 4%, var(--wg-bg));
  --wg-surface-2: color-mix(in srgb, var(--wg-fg) 7%, var(--wg-bg));
  --wg-surface-3: color-mix(in srgb, var(--wg-fg) 11%, var(--wg-bg));
  --wg-elevated: color-mix(in srgb, var(--wg-fg) 6%, var(--wg-bg));
  --wg-border: color-mix(in srgb, var(--wg-fg) 10%, transparent);
  --wg-border-strong: color-mix(in srgb, var(--wg-fg) 18%, transparent);
  --wg-muted: color-mix(in srgb, var(--wg-fg) 62%, transparent);
  --wg-subtle: color-mix(in srgb, var(--wg-fg) 42%, transparent);
  --wg-accent-soft: color-mix(in srgb, var(--wg-accent) 14%, transparent);
  --wg-accent-softer: color-mix(in srgb, var(--wg-accent) 8%, transparent);
  --wg-accent-ring: color-mix(in srgb, var(--wg-accent) 45%, transparent);
  --wg-success: #22c55e;
  --wg-warning: #f59e0b;
  --wg-danger: #ef4444;
  --wg-star: #fbbf24;
  --wg-radius-lg: 16px;
  --wg-radius: 12px;
  --wg-radius-sm: 8px;
  --wg-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.18);
  --wg-shadow: 0 1px 2px rgba(0, 0, 0, 0.16), 0 12px 32px -16px rgba(0, 0, 0, 0.5);
  --wg-shadow-lg: 0 24px 64px -20px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.2);
  --wg-mono: ui-monospace, 'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace;
  --wg-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  color: var(--wg-fg);
}

*, *::before, *::after { box-sizing: border-box; }

/* Buttons */
.wg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--wg-border);
  background: var(--wg-surface-2);
  color: var(--wg-fg);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s var(--wg-ease), border-color 0.15s var(--wg-ease),
    transform 0.15s var(--wg-ease), box-shadow 0.15s var(--wg-ease), color 0.15s var(--wg-ease);
}
.wg-btn:hover:not(:disabled) { background: var(--wg-surface-3); border-color: var(--wg-border-strong); }
.wg-btn:active:not(:disabled) { transform: translateY(1px); }
.wg-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--wg-accent-ring); }
.wg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.wg-btn i { font-size: 12px; }
.wg-btn-primary {
  border-color: transparent;
  background: var(--wg-gradient);
  color: var(--wg-accent-fg);
  box-shadow: 0 6px 18px -8px var(--wg-accent);
}
.wg-btn-primary:hover:not(:disabled) {
  background: var(--wg-gradient);
  border-color: transparent;
  filter: brightness(1.08);
  box-shadow: 0 10px 24px -10px var(--wg-accent);
}
.wg-btn-ghost { background: transparent; border-color: transparent; color: var(--wg-muted); }
.wg-btn-ghost:hover:not(:disabled) { background: var(--wg-surface-2); color: var(--wg-fg); border-color: transparent; }
.wg-btn-danger { color: var(--wg-danger); }
.wg-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--wg-danger) 14%, transparent);
  border-color: color-mix(in srgb, var(--wg-danger) 40%, transparent);
}
.wg-btn-sm { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 8px; }

.wg-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--wg-muted);
  cursor: pointer;
  transition: background 0.15s var(--wg-ease), color 0.15s var(--wg-ease), transform 0.15s var(--wg-ease);
}
.wg-icon-btn:hover:not(:disabled) { background: var(--wg-surface-2); color: var(--wg-fg); }
.wg-icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--wg-accent-ring); }
.wg-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.wg-icon-btn.active { background: var(--wg-accent-soft); color: var(--wg-accent); }
.wg-icon-btn-sm { width: 28px; height: 28px; border-radius: 8px; font-size: 12px; }

/* Inputs */
.wg-input, .wg-select, .wg-textarea {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--wg-border);
  background: var(--wg-surface);
  color: var(--wg-fg);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s var(--wg-ease), box-shadow 0.15s var(--wg-ease), background 0.15s var(--wg-ease);
}
.wg-input::placeholder, .wg-textarea::placeholder { color: var(--wg-subtle); }
.wg-input:focus, .wg-select:focus, .wg-textarea:focus {
  border-color: var(--wg-accent);
  box-shadow: 0 0 0 3px var(--wg-accent-soft);
  background: var(--wg-bg);
}
.wg-textarea { height: auto; min-height: 88px; padding: 10px 12px; resize: vertical; line-height: 1.5; }
.wg-textarea.wg-code { font-family: var(--wg-mono); font-size: 12.5px; min-height: 140px; }
.wg-select { appearance: none; padding-right: 32px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--wg-muted) 50%), linear-gradient(135deg, var(--wg-muted) 50%, transparent 50%);
  background-position: calc(100% - 16px) 15px, calc(100% - 11px) 15px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.wg-select option { background: var(--wg-bg); color: var(--wg-fg); }

.wg-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.wg-field > label, .wg-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--wg-subtle);
}
.wg-hint { font-size: 12px; color: var(--wg-subtle); line-height: 1.45; }
.wg-row { display: flex; gap: 10px; }
.wg-row > * { flex: 1; min-width: 0; }

/* Chips */
.wg-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--wg-border);
  background: var(--wg-surface-2);
  color: var(--wg-muted);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.wg-chip-accent { background: var(--wg-accent-soft); border-color: transparent; color: var(--wg-accent); }
button.wg-chip { cursor: pointer; transition: all 0.15s var(--wg-ease); }
button.wg-chip:hover { color: var(--wg-fg); border-color: var(--wg-border-strong); }
button.wg-chip.active { background: var(--wg-accent); border-color: transparent; color: var(--wg-accent-fg); }

/* Segmented control */
.wg-segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: 10px;
  background: var(--wg-surface-2);
  border: 1px solid var(--wg-border);
}
.wg-segmented button {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--wg-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s var(--wg-ease);
}
.wg-segmented button:hover { color: var(--wg-fg); }
.wg-segmented button.active { background: var(--wg-bg); color: var(--wg-fg); box-shadow: var(--wg-shadow-sm); }

/* Keyboard hint */
.wg-kbd {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--wg-border-strong);
  border-bottom-width: 2px;
  background: var(--wg-surface);
  color: var(--wg-muted);
  font-family: var(--wg-mono);
  font-size: 10.5px;
  font-weight: 600;
}

/* Status dot */
.wg-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wg-subtle); flex-shrink: 0; }
.wg-dot.online { background: var(--wg-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--wg-success) 22%, transparent); }
.wg-dot.offline { background: var(--wg-danger); }

/* Switch */
.wg-switch { position: relative; display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; }
.wg-switch input { position: absolute; opacity: 0; pointer-events: none; }
.wg-switch .track {
  width: 34px; height: 20px; border-radius: 999px; background: var(--wg-surface-3);
  border: 1px solid var(--wg-border); position: relative; transition: background 0.2s var(--wg-ease); flex-shrink: 0;
}
.wg-switch .track::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); transition: transform 0.2s var(--wg-ease);
}
.wg-switch input:checked + .track { background: var(--wg-accent); border-color: transparent; }
.wg-switch input:checked + .track::after { transform: translateX(14px); }
.wg-switch input:focus-visible + .track { box-shadow: 0 0 0 3px var(--wg-accent-ring); }

/* Scrollbars */
.wg-scroll { overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--wg-surface-3) transparent; }
.wg-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.wg-scroll::-webkit-scrollbar-track { background: transparent; }
.wg-scroll::-webkit-scrollbar-thumb {
  background: var(--wg-surface-3); border-radius: 999px; border: 3px solid transparent; background-clip: content-box;
}
.wg-scroll::-webkit-scrollbar-thumb:hover { background: var(--wg-border-strong); background-clip: content-box; }

/* Drawer (side panel editor) */
.wg-drawer-backdrop {
  position: fixed; inset: 0; z-index: 1050;
  background: color-mix(in srgb, #000 45%, transparent);
  backdrop-filter: blur(3px);
  animation: wg-fade-in 0.18s var(--wg-ease);
}
.wg-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 1051;
  width: min(480px, 100vw);
  display: flex; flex-direction: column;
  background: var(--wg-bg);
  border-left: 1px solid var(--wg-border);
  box-shadow: var(--wg-shadow-lg);
  animation: wg-slide-in 0.24s var(--wg-ease);
}
.wg-drawer-header { display: flex; align-items: center; gap: 14px; padding: 20px 22px 16px; border-bottom: 1px solid var(--wg-border); }
.wg-drawer-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
.wg-drawer-subtitle { font-size: 12px; color: var(--wg-subtle); margin-top: 2px; }
.wg-drawer-body { flex: 1; padding: 18px 22px; }
.wg-drawer-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--wg-border); background: var(--wg-surface); }
.wg-section-title {
  display: flex; align-items: center; gap: 8px; margin: 22px 0 12px;
  font-size: 12px; font-weight: 700; color: var(--wg-fg); letter-spacing: 0.01em;
}
.wg-section-title:first-child { margin-top: 0; }
.wg-section-title i { color: var(--wg-accent); font-size: 12px; }
.wg-section-title::after { content: ''; flex: 1; height: 1px; background: var(--wg-border); }

/* Popover menu */
.wg-menu {
  position: absolute; z-index: 30; min-width: 220px; padding: 6px;
  border-radius: 12px; border: 1px solid var(--wg-border-strong);
  background: var(--wg-bg); box-shadow: var(--wg-shadow-lg);
  animation: wg-pop-in 0.14s var(--wg-ease);
}
.wg-menu-label { padding: 8px 10px 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--wg-subtle); }
.wg-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px;
  border: 0; border-radius: 8px; background: transparent; color: var(--wg-fg);
  font-size: 13px; text-align: left; cursor: pointer;
}
.wg-menu-item:hover:not(:disabled) { background: var(--wg-surface-2); }
.wg-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
.wg-menu-item i { width: 14px; color: var(--wg-muted); text-align: center; }
.wg-menu-item .meta { margin-left: auto; color: var(--wg-subtle); font-size: 11px; }
.wg-menu-divider { height: 1px; margin: 6px 4px; background: var(--wg-border); }

/* Empty state */
.wg-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 56px 24px; gap: 10px; }
.wg-empty-icon {
  width: 72px; height: 72px; border-radius: 22px; display: flex; align-items: center; justify-content: center;
  margin-bottom: 8px; font-size: 26px; color: var(--wg-accent-fg);
  background: var(--wg-gradient); box-shadow: 0 18px 40px -16px var(--wg-accent);
}
.wg-empty h4 { margin: 0; font-size: 16px; font-weight: 700; }
.wg-empty p { margin: 0; max-width: 360px; color: var(--wg-muted); font-size: 13px; line-height: 1.5; }

@keyframes wg-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes wg-slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wg-pop-in { from { transform: translateY(-4px) scale(0.98); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wg-rise { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wg-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

/** Preset accent colors offered for hosts */
export const HOST_COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#f59e0b', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];
