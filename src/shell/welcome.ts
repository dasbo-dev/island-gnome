import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js'

/**
 * The one thing the extension says on its own initiative.
 *
 * With `always-show` false and no session running, enabling the extension puts
 * nothing in the top bar at all — so there is no island to click, no popup to
 * open, and nothing anywhere that says hooks have to be installed before a
 * session can ever appear. A notification is the only surface left.
 *
 * Posted from the extension rather than the island for that same reason: the
 * island may not exist on screen at the moment this matters.
 *
 * `welcome-shown` is the record that it fired. Setting it before the user
 * interacts is deliberate — a user who dismisses this should not meet it again
 * on the next login.
 */
export function maybeShowWelcome(settings: Gio.Settings, onOpenSettings: () => void): void {
  if (settings.get_boolean('welcome-shown')) return
  settings.set_boolean('welcome-shown', true)

  const source = new MessageTray.Source({
    title: 'Dasbo Island',
    iconName: 'dialog-information-symbolic',
  })
  Main.messageTray.add(source)

  const notification = new MessageTray.Notification({
    source,
    title: 'Dasbo Island is ready',
    body: 'Install hooks for Claude Code or Codex to see sessions here.',
  })
  notification.addAction('Open settings', () => onOpenSettings())
  source.addNotification(notification)
}
