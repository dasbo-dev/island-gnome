/**
 * The identity the preferences window shows. Kept here rather than beside the
 * page that renders it because src/prefs pulls in GJS bindings that no test
 * in this repo can reach past — a typo in the donation URL would ship
 * silently. test/core/about.test.ts is what makes these strings checkable.
 */
export const ABOUT = {
  author: 'fsevenm',
  repoUrl: 'https://github.com/dasbo-dev/island-gnome',
  issuesUrl: 'https://github.com/dasbo-dev/island-gnome/issues',
  supportUrl: 'https://buymeacoffee.com/fsevenm',
  license: 'GPL-3.0-or-later',
  // Relative to the installed extension directory; the page joins it onto
  // ExtensionPreferences.path.
  qrAsset: 'assets/qr-code.png',
} as const
