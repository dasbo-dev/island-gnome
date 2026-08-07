import { describe, expect, it } from 'vitest'
import { KEYS, LOOP_MS, TIMELINE, storeAt } from '../../site/timeline.js'
import { pillState } from '../../src/core/pillState.js'
import { activityText } from '../../src/core/activity.js'
import { summarize } from '../../src/core/tasks.js'

describe('demo timeline', () => {
  it('is sorted and fits inside the loop', () => {
    for (let i = 1; i < TIMELINE.length; i++) {
      expect(TIMELINE[i]!.at).toBeGreaterThanOrEqual(TIMELINE[i - 1]!.at)
    }
    expect(TIMELINE.at(-1)!.at).toBeLessThan(LOOP_MS)
  })

  it('walks the pill through every state the page claims to show', () => {
    const at = (t: number) => pillState(storeAt(t).list())
    expect(at(100)).toBe('idle')
    expect(at(500)).toBe('running')
    expect(at(9_500)).toBe('waiting')
    expect(at(13_100)).toBe('running')
    expect(at(16_500)).toBe('error')
    expect(at(19_500)).toBe('running')
    expect(at(27_000)).toBe('done')
  })

  it('shows both agents at once mid-loop', () => {
    expect(storeAt(6_000).list().map((s) => s.agent).sort())
      .toEqual(['claude', 'codex'])
  })

  it('holds a permission the row can describe', () => {
    const s = storeAt(10_000).get(KEYS.claude)!
    expect(s.pendingPermission?.tool).toBe('Bash')
    expect(activityText(s, 10_000).text).toContain('waiting for you · Bash')
  })

  it('finishes the plan it shows', () => {
    const s = storeAt(23_000).get(KEYS.claude)!
    expect(summarize(s.tasks!)).toEqual({ completed: 6, total: 6 })
  })
})
