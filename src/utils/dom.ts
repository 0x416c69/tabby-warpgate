/**
 * DOM helpers for the plugin's components
 */

/**
 * Whether an element is on screen and keyboard focus is inside it (or nowhere in particular)
 * Used to ignore global key presses meant for other tabs, e.g. a terminal next to the panel
 */
export function isElementActive(element: HTMLElement | null | undefined): boolean {
  if (!element || element.getClientRects().length === 0) {
    return false;
  }
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  return !active || active === document.body || element.contains(active);
}
