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
  }

  it('taskList.ts owns no scroll view', () => {
    expect(readFileSync('src/shell/taskList.ts', 'utf8')).not.toContain('ScrollView')
  })

  it('the stylesheet caps no list inside a row', () => {
    expect(readFileSync('stylesheet.css', 'utf8')).not.toContain('dasbo-tasks-scroll')
  })
})
