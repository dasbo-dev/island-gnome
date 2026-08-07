import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import Gio from 'gi://Gio'
import { ABOUT } from '../core/about.js'
import { logoAsset } from '../core/logo.js'

// The identity page: who wrote this, where it lives, how to say thanks.
// Everything it renders comes from ABOUT or from its arguments, so the strings
// stay checkable by a test that cannot import this file — see
// test/core/about.test.ts and test/prefs/aboutPage.test.ts.
export function aboutPage(
  window: Adw.PreferencesWindow,
  extensionPath: string,
  version: string
): Adw.PreferencesPage {
  const page = new Adw.PreferencesPage({ title: 'About', icon_name: 'help-about-symbolic' })

  page.add(_banner(extensionPath, version))
  page.add(_identity(window))
  page.add(_support(window, extensionPath))

  return page
}

// The page's identity, shown the way GNOME's own about windows show it: the
// mark, the name, the version. Everything below it is a row.
function _banner(extensionPath: string, version: string): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup()

  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    margin_top: 24,
    margin_bottom: 12,
    halign: Gtk.Align.CENTER,
  })

  const manager = Adw.StyleManager.get_default()
  const file = _logoFile(extensionPath, manager.dark)
  // The same check the QR makes below, for the same reason: a Gtk.Image handed
  // a path that isn't there draws nothing and reports nothing. Without the
  // image the name and version still render, so a missing asset costs the page
  // a decoration rather than its content.
  if (file.query_exists(null)) {
    // Gtk.Image with pixel_size, not the Picture widget _qrRow uses below:
    // pixel_size *is* the image's minimum size, so it cannot collapse the way
    // the QR did inside a clamp (see the note there).
    const image = Gtk.Image.new_from_gicon(Gio.FileIcon.new(file))
    image.pixel_size = 96

    // The preferences window outlives a theme switch, so the variant is
    // re-resolved rather than fixed at build time.
    const handler = manager.connect('notify::dark', () => {
      const next = _logoFile(extensionPath, manager.dark)
      // Keep the mark already on screen if the other variant is missing.
      if (next.query_exists(null)) image.gicon = Gio.FileIcon.new(next)
    })
    image.connect('destroy', () => manager.disconnect(handler))

    box.append(image)
  }

  const name = new Gtk.Label({ label: 'Dasbo Island' })
  name.add_css_class('title-1')
  box.append(name)

  const versionLabel = new Gtk.Label({ label: version })
  versionLabel.add_css_class('dim-label')
  box.append(versionLabel)

  const row = new Adw.PreferencesRow({ activatable: false, selectable: false })
  row.set_child(box)
  group.add(row)

  return group
}

function _logoFile(extensionPath: string, dark: boolean): Gio.File {
  return Gio.File.new_for_path(`${extensionPath}/${logoAsset(dark)}`)
}

// The name and version live in the banner above, so this group carries only
// the facts that have nowhere else to go — and no title, which would repeat
// the name a second time on the same page.
function _identity(window: Adw.PreferencesWindow): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup()

  group.add(new Adw.ActionRow({ title: 'Author', subtitle: ABOUT.author }))
  group.add(new Adw.ActionRow({ title: 'Licence', subtitle: ABOUT.license }))
  group.add(_linkRow(window, 'GitHub', ABOUT.repoUrl))
  group.add(_linkRow(window, 'Report an issue', ABOUT.issuesUrl))

  return group
}

// The whole row is the target rather than a button at its end: a link row that
// only responds to a 16px icon is a worse version of the same affordance.
function _linkRow(window: Adw.PreferencesWindow, title: string, uri: string): Adw.ActionRow {
  const row = new Adw.ActionRow({ title, subtitle: _display(uri), activatable: true })
  // external-link-symbolic isn't a stock Adwaita icon — it's absent from
  // /usr/share/icons/Adwaita and only renders on machines whose icon theme
  // (e.g. Yaru) happens to ship a copy. adw-external-link-symbolic ships in
  // libadwaita's own GResource, so it's always there.
  row.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic', valign: Gtk.Align.CENTER }))
  row.connect('activated', () => _open(window, uri))
  return row
}

function _support(window: Adw.PreferencesWindow, extensionPath: string): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup({
    title: 'Support',
    description: 'Dasbo Island is free and GPL-licensed. If it saves you time, a coffee keeps it going.',
  })

  // The page's visual weight. Everything above this is a plain row, so the
  // accent lands on the one thing the user might want to do here.
  const button = new Gtk.Button({
    label: 'Buy me a coffee',
    halign: Gtk.Align.FILL,
    margin_top: 6,
    margin_bottom: 6,
  })
  button.add_css_class('suggested-action')
  button.add_css_class('pill')
  button.connect('clicked', () => _open(window, ABOUT.supportUrl))

  const buttonRow = new Adw.PreferencesRow({ activatable: false, selectable: false })
  buttonRow.set_child(button)
  group.add(buttonRow)

  // Checked once, here, because the two branches below need different
  // widgets rather than the same widget minus a picture: an expander that
  // promises a QR code and reveals nothing but a dim address is a worse
  // affordance than not offering it at all.
  const file = Gio.File.new_for_path(`${extensionPath}/${ABOUT.qrAsset}`)
  if (file.query_exists(null)) {
    // An expander rather than a dialog: the QR is a thing you hold a phone up
    // to, and a modal you have to dismiss with one hand while aiming a camera
    // with the other is worse than a panel that just stays open.
    const expander = new Adw.ExpanderRow({
      title: 'Show QR code',
      subtitle: 'Scan with your phone to donate',
    })
    expander.add_row(_qrRow(file))
    group.add(expander)
  } else {
    // No image to show, so no expander to promise one — a plain link row
    // carrying the same address the QR would have encoded.
    group.add(_linkRow(window, 'Donate', ABOUT.supportUrl))
  }

  return group
}

function _qrRow(file: Gio.File): Adw.PreferencesRow {
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    margin_top: 18,
    margin_bottom: 18,
    halign: Gtk.Align.CENTER,
  })

  const picture = Gtk.Picture.new_for_file(file)
  picture.can_shrink = true
  // A minimum size request, not a clamp. can_shrink drops the picture's own
  // minimum to 0, and a clamp caps what a child may grow to without ever
  // granting it size — wrapping this picture in one was measured allocating
  // 200×0 against real GTK 4.14: the width held, but the height collapsed to
  // the picture's zero minimum, an invisible QR with a green test suite.
  // set_size_request raises the *minimum*, which is what forces a non-zero
  // allocation in both dimensions. test/prefs/aboutPage.test.ts pins both
  // halves of that.
  picture.set_size_request(200, 200)
  box.append(picture)

  const label = new Gtk.Label({ label: _display(ABOUT.supportUrl), selectable: true })
  label.add_css_class('dim-label')
  box.append(label)

  const row = new Adw.PreferencesRow({ activatable: false, selectable: false })
  row.set_child(box)
  return row
}

// Rows show the address without its scheme, which is eight characters of
// noise in a subtitle nobody reads for the protocol.
function _display(uri: string): string {
  return uri.replace(/^https:\/\//, '')
}

function _open(window: Adw.PreferencesWindow, uri: string): void {
  const launcher = new Gtk.UriLauncher({ uri })
  // @girs types Gtk.UriLauncher.launch as a plain two-argument, callback-free
  // method: the generator only adds a callback parameter to methods whose
  // name ends in `_async`, and GTK named this one `launch` instead. GTK's own
  // docs for this method describe a callback that resolves through
  // launch_finish, exactly like every other GIO async pair — the cast below
  // restores that parameter so the real, documented signature can be used.
  type Launch = (
    parent: Gtk.Window | null,
    cancellable: Gio.Cancellable | null,
    callback: (source: Gtk.UriLauncher, result: Gio.AsyncResult) => void
  ) => void
  // GJS methods live on the prototype and resolve their instance through
  // `this` at call time; pulling `launch` off `launcher` into a bare function
  // and invoking it detached loses that receiver and throws synchronously,
  // before the callback — and the try/catch below — ever run. `.call` keeps
  // `launcher` bound as `this`, so do not "simplify" this back into a plain
  // `launch(window, null, cb)` invocation.
  ;(launcher.launch as unknown as Launch).call(launcher, window, null, (_source, result) => {
    try {
      launcher.launch_finish(result)
    } catch {
      // No browser, or a session that won't let us reach one. The address is
      // the only thing the user actually needs, so hand it over verbatim
      // rather than reporting a failure they can do nothing with.
      window.add_toast(new Adw.Toast({ title: uri }))
    }
  })
}
