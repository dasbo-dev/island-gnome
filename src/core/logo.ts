/**
 * Which variant of the project mark to draw, and where it lives.
 *
 * Kept out of the two GJS files that render it for the reason src/core/
 * about.ts exists: no test in this repo can import src/shell or src/prefs, so
 * a light/dark mapping written inline there would be unreachable — and a mark
 * drawn in the wrong variant is invisible rather than wrong-looking.
 *
 * The names describe the theme each file belongs to, not the ink it is drawn
 * in: logo-light.svg has a dark (#2E2E33) body for light backgrounds,
 * logo-dark.svg a light (#E9E9EC) body for dark ones. That is the sense the
 * README's <picture> element already uses.
 *
 * Both paths are relative to the installed extension directory; the call
 * sites join them onto their own base path, as ABOUT.qrAsset is joined.
 */
export const LOGO = {
  light: 'assets/logo-light.svg',
  dark: 'assets/logo-dark.svg',
} as const

/** The mark to draw against a background of the given darkness. */
export function logoAsset(dark: boolean): string {
  return dark ? LOGO.dark : LOGO.light
}

/**
 * Whether a raw `org.gnome.desktop.interface color-scheme` string means a dark
 * background.
 *
 * Shell-side only. The preferences window has Adw.StyleManager.dark, which is
 * a better answer there — it also accounts for a dark style the application
 * itself forced — so the About page passes that boolean straight to logoAsset
 * and never calls this.
 *
 * Everything that is not an explicit 'prefer-light' counts as dark, including
 * 'default': the Shell's popup is dark unless the user has asked otherwise,
 * and an unrecognised value from a later GNOME should fail toward the common
 * case rather than the rare one.
 */
export function prefersDark(colorScheme: string): boolean {
  return colorScheme !== 'prefer-light'
}
