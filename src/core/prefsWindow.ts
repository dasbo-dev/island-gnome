/**
 * The preferences window's opening size.
 *
 * Here rather than at the call site for the same reason src/core/about.ts is:
 * src/prefs.ts imports GJS bindings no test in this repo can reach past, so
 * a number typed into fillPreferencesWindow ships unchecked. This record is
 * importable, and test/core/prefsWindow.test.ts holds it to a range.
 *
 * 700 because the About page runs to roughly 560-600px — banner, four identity
 * rows, and the Support group — and the whole point of setting a size at all is
 * that the Support group opens above the fold, with room for a row or two more
 * before that stops being true. Neither the shell's ExtensionPrefsDialog nor
 * libadwaita sets one, so without this the window opens at whatever natural
 * size the content works out to, which was too short.
 *
 * On a screen with less than 700px of work area, GTK4's
 * gtk_window_compute_default_size clamps this against the monitor, so a short
 * screen gets "as tall as fits" rather than a window running off the bottom.
 * That clamp is why this is a constant and not a calculation: the platform
 * already does the arithmetic, and doing it here would mean guessing which
 * monitor the window opens on before it is mapped.
 */
export const PREFS_WINDOW = { width: 600, height: 700 } as const
