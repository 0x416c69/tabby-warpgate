/**
 * Bootstrap Theme Constants
 * Centralized color and icon definitions for Warpgate targets
 */

/**
 * Bootstrap theme color palette
 * Used for target color coding throughout the UI
 */
export const BOOTSTRAP_COLORS: Record<string, string> = {
  primary: '#007bff',
  secondary: '#6c757d',
  success: '#28a745',
  danger: '#dc3545',
  warning: '#ffc107',
  info: '#17a2b8',
  light: '#f8f9fa',
  dark: '#343a40',
};

/**
 * Font Awesome icons mapped to theme colors
 * Used for visual representation of targets
 */
export const THEME_ICONS: Record<string, string> = {
  primary: 'fas fa-server',
  secondary: 'fas fa-desktop',
  success: 'fas fa-check-circle',
  danger: 'fas fa-exclamation-triangle',
  warning: 'fas fa-exclamation-circle',
  info: 'fas fa-info-circle',
  light: 'fas fa-sun',
  dark: 'fas fa-moon',
};

/**
 * Get Bootstrap color hex code by theme name
 * @param colorName Theme color name (primary, secondary, etc.)
 * @returns Hex color code or undefined if not found
 */
export function getBootstrapColor(colorName?: string): string | undefined {
  if (!colorName) {
    return undefined;
  }
  return BOOTSTRAP_COLORS[colorName];
}

/**
 * Get Font Awesome icon class by theme name
 * @param colorName Theme color name (primary, secondary, etc.)
 * @returns Font Awesome icon class, defaults to 'fas fa-server'
 */
export function getThemeIcon(colorName?: string): string {
  if (!colorName) {
    return 'fas fa-server';
  }
  return THEME_ICONS[colorName] || 'fas fa-server';
}
