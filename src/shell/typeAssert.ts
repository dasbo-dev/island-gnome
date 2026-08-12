/**
 * Compile-time assertions, used by the registered classes in this directory.
 *
 * `GObject.registerClass()` returns a constructor whose parameters
 * @girs/gobject-2.0 derives from `_init` rather than from the TypeScript
 * `constructor`, so each registered class is re-exported through an
 * `as unknown as` cast that restores the real signature. The cast suppresses
 * checking; `Assert` puts a compile error back where the checking used to be.
 *
 * Nothing here emits any runtime code.
 */

/**
 * True only when X and Y are the same type — including when one is `any` and
 * the other is not, which a bare conditional would let through. The deferred
 * -conditional trick is the standard way to get invariant equality out of
 * TypeScript.
 */
export type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false

/** A compile error unless `T` resolves to `true`. */
export type Assert<T extends true> = T
