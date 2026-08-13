/**
 * Compile-time assertions, used by the registered classes in this directory.
 *
 * `GObject.registerClass()` returns a constructor whose parameters
 * @girs/gobject-2.0 derives from `_init` rather than from the TypeScript
 * `constructor`, so each registered class is re-exported through an
 * `as unknown as` cast that restores the real signature. The cast suppresses
 * checking; `Assert` puts a compile error back where the checking used to be.
 *
 * A second idiom coexists in this codebase, though: `agentChip.ts` and
 * `gridIcon.ts` still call `GObject.registerClass(class X extends St.Whatever
 * { … })` inline, no cast and no `Assert`, even though `AgentChip`'s
 * constructor also takes plain positional arguments the way `PopupHeader`'s
 * and `SessionRow`'s do. Which idiom a new widget needs depends entirely on
 * what its base class's `_init` is typed as. `@girs/st-18` declares
 * `_init(...args: any[]): void`, so for a class based straight on St,
 * `Parameters<P['_init']>` widens to `any[]` and any constructor typechecks
 * without help — that's why the inline form is fine for `AgentChip` and
 * `GridIcon`. The classes in *this* directory extend `PanelMenu.Button` or
 * `PopupMenu.PopupBaseMenuItem`, and `@girs/gnome-shell`'s hand-written
 * `dist/ui/popupMenu.d.ts` types `PopupBaseMenuItem#_init` concretely, as
 * `(params?: Partial<PopupBaseMenuItem.ConstructorProps>) => void` — that
 * narrows, and is exactly what the cast and `Assert` here work around. One
 * consequence worth knowing: `AgentChip`'s registered constructor is typed to
 * accept anything, because nothing in `St.BoxLayout`'s typings ever narrowed
 * it, even though the real constructor requires three arguments.
 *
 * Nothing here emits any runtime code.
 */

/**
 * True only when X and Y are the same type — including when one is `any` and
 * the other is not, which a bare conditional would let through. The
 * deferred-conditional trick is the standard way to get invariant equality
 * out of TypeScript.
 */
export type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false

/** A compile error unless `T` resolves to `true`. */
export type Assert<T extends true> = T
