/**
 * GNOME Shell patches `ease()` / `ease_property()` onto `Clutter.Actor.prototype`
 * at runtime (see `ui/environment.js`); the method is not part of the Clutter
 * GIR, so `@girs/clutter-14` does not type it. This augmentation fills that
 * gap for `Clutter.Actor` (and, through inheritance, `St.Widget`) without
 * touching `tsconfig.json`.
 */
declare module '@girs/clutter-14/clutter-14' {
  namespace Clutter {
    interface Actor {
      ease(props: {
        duration?: number
        delay?: number
        mode?: AnimationMode
        repeatCount?: number
        autoReverse?: boolean
        animationRequired?: boolean
        onComplete?: () => void
        onStopped?: (finished: boolean) => void
        [prop: string]: unknown
      }): void
    }
  }
}

export {}
