import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// St has no `text-overflow`, so truncation is a per-label decision made in code.
// Two labels are deliberately never truncated — an option's description and a
// task's subject are the content the reader opened the popup for — and both are
// one careless edit away from being ellipsized again. The popup is bounded at the
// popup level instead (see island.ts), which is also why the task list must not
// carry a scroll view or a max-height of its own: nested scroll views inside a
// popup fight over the mouse wheel.
describe('the popup never truncates an option or a task', () => {
  for (const file of ['src/shell/questionPanel.ts', 'src/shell/taskList.ts']) {
    it(`${file} sets no ellipsize mode other than NONE`, () => {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toContain('EllipsizeMode.END')
      expect(src).not.toContain('EllipsizeMode.START')
      expect(src).not.toContain('EllipsizeMode.MIDDLE')
    })

    // The negative assertions above pass just as well on a label that never
    // wraps at all — deleting line_wrap or line_wrap_mode leaves every
    // EllipsizeMode check green while producing a single unwrapped line that
    // overhangs the popup's fixed 26em width. That is a different failure from
    // an ellipsis, and just as bad, so the positive half of the invariant needs
    // its own guard.
    it(`${file} still wraps rather than growing one long line`, () => {
      const src = readFileSync(file, 'utf8')
      expect(src).toContain('line_wrap = true')
      expect(src).toContain('Pango.WrapMode.WORD_CHAR')
      expect(src).toContain('Pango.EllipsizeMode.NONE')
    })
  }

  it('taskList.ts owns no scroll view', () => {
    expect(readFileSync('src/shell/taskList.ts', 'utf8')).not.toContain('ScrollView')
  })

  it('the stylesheet caps no list inside a row', () => {
    const css = readFileSync('stylesheet.css', 'utf8')
    // The class name itself: catches the exact rule this feature deleted
    // coming back verbatim.
    expect(css).not.toContain('dasbo-tasks-scroll')
    // The class name alone would miss a cap reintroduced under any other
    // name — a `.dasbo-task-subject { max-height: ... }` added later would
    // pass the check above while clipping subjects again. Matching any
    // dasbo-task* selector that carries a max-height declaration catches
    // that regardless of what the rule is called.
    expect(css).not.toMatch(/\.dasbo-task[^{]*\{[^}]*max-height/)
  })
})
