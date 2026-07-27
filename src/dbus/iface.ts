export const BUS_NAME = 'org.dasbo.Island'
export const OBJECT_PATH = '/org/dasbo/Island'

export const IFACE_XML = `
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
