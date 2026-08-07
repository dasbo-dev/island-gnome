import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import Gio from 'gi://Gio'
import { ABOUT } from '../core/about.js'

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

  page.add(_identity(window, version))
  page.add(_support(window, extensionPath))

  return page
}

function _identity(window: Adw.PreferencesWindow, version: string): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup({ title: 'Dasbo Island' })

  group.add(new Adw.ActionRow({ title: 'Author', subtitle: ABOUT.author }))
  group.add(new Adw.ActionRow({ title: 'Version', subtitle: version }))
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
    description: 'Dasbo Island is free and GPL-licenced. If it saves you time, a coffee keeps it going.',
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
  // set_size_request only raises a widget's minimum size; Gtk.Picture's
  // natural size stays the image's intrinsic 700x700 regardless, and inside
  // the page's clamp that natural size is what gets allocated — forcing the
  // expander open to roughly the height of the whole window. Adw.Clamp caps
  // the natural width instead, and Picture's aspect-ratio preservation keeps
  // the (square) image square as its height follows.
  const clamp = new Adw.Clamp({ maximum_size: 200, child: picture })
  box.append(clamp)

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
