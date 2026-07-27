// Minimal stand-in for the extension's D-Bus service, used by the hook tests.
// Owns org.dasbo.Island on whatever bus the test harness started, writes the
// first payload it is handed to ARGV[0], then quits.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

const IFACE_XML = `
<node>
  <interface name="org.dasbo.Island">
    <method name="Notify">
      <arg type="s" direction="in" name="agent"/>
      <arg type="s" direction="in" name="event"/>
      <arg type="s" direction="in" name="cwd"/>
      <arg type="i" direction="in" name="pid"/>
      <arg type="s" direction="in" name="payloadJson"/>
    </method>
    <method name="RequestPermission">
      <arg type="s" direction="in" name="agent"/>
      <arg type="s" direction="in" name="event"/>
      <arg type="s" direction="in" name="cwd"/>
      <arg type="i" direction="in" name="pid"/>
      <arg type="s" direction="in" name="payloadJson"/>
      <arg type="s" direction="out" name="decisionJson"/>
    </method>
    <method name="Ping">
      <arg type="s" direction="out" name="version"/>
    </method>
  </interface>
</node>
`

const outPath = ARGV[0]
const loop = GLib.MainLoop.new(null, false)

function record(agent, event, cwd, pid, payloadJson) {
  GLib.file_set_contents(
    outPath,
    JSON.stringify({ agent, event, cwd, pid, payloadJson })
  )
  GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    loop.quit()
    return GLib.SOURCE_REMOVE
  })
}

const handler = {
  Ping: () => '0.0.0-stub',
  Notify: (agent, event, cwd, pid, payloadJson) => {
    record(agent, event, cwd, pid, payloadJson)
  },
  RequestPermission: (agent, event, cwd, pid, payloadJson) => {
    record(agent, event, cwd, pid, payloadJson)
    return JSON.stringify({ stub: 'decision' })
  },
}

const impl = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, handler)
impl.export(Gio.DBus.session, '/org/dasbo/Island')
Gio.bus_own_name(
  Gio.BusType.SESSION,
  'org.dasbo.Island',
  Gio.BusNameOwnerFlags.NONE,
  null,
  () => print('ready'),
  () => {
    printerr('stub: could not own the bus name')
    loop.quit()
  }
)

loop.run()
