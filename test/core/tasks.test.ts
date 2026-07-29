import { describe, it, expect } from 'vitest'
import {
  parseTaskFile,
  sortTasks,
  summarize,
  sameTasks,
  toTaskStatus,
  type AgentTask,
} from '../../src/core/tasks.js'

/** Copied verbatim from ~/.claude/tasks/<session>/9.json on a real session. */
const realFile = {
  id: '9',
  subject: 'Task 9: QuestionPanel widget',
  description: 'src/shell/questionPanel.ts plus stylesheet rules',
  activeForm: 'Building the question panel',
  status: 'completed',
  blocks: [],
  blockedBy: [],
}

function task(over: Partial<AgentTask> = {}): AgentTask {
  return { id: '1', subject: 'Explore project context', status: 'pending', ...over }
}

describe('parseTaskFile', () => {
  it('keeps the three fields the row renders and drops the rest', () => {
    expect(parseTaskFile(realFile)).toEqual({
      id: '9',
      subject: 'Task 9: QuestionPanel widget',
      status: 'completed',
    })
  })

  it('accepts a file with no activeForm', () => {
    const { activeForm, ...rest } = realFile
    expect(parseTaskFile(rest)).toEqual({
      id: '9',
      subject: 'Task 9: QuestionPanel widget',
      status: 'completed',
    })
  })

  it('accepts every status in the vocabulary', () => {
    for (const status of ['pending', 'in_progress', 'completed']) {
      expect(parseTaskFile({ ...realFile, status })?.status).toBe(status)
    }
  })

  it('rejects an unrecognised status rather than rendering it', () => {
    expect(parseTaskFile({ ...realFile, status: 'deleted' })).toBeNull()
  })

  it('rejects a file missing id, subject or status', () => {
    expect(parseTaskFile({ ...realFile, id: undefined })).toBeNull()
    expect(parseTaskFile({ ...realFile, subject: '' })).toBeNull()
    expect(parseTaskFile({ ...realFile, status: undefined })).toBeNull()
  })

  it('rejects anything that is not an object', () => {
    expect(parseTaskFile(null)).toBeNull()
    expect(parseTaskFile('9')).toBeNull()
    expect(parseTaskFile([realFile])).toBeNull()
  })
})

describe('toTaskStatus', () => {
  it('passes the vocabulary through and rejects everything else', () => {
    expect(toTaskStatus('in_progress')).toBe('in_progress')
    expect(toTaskStatus('blocked')).toBeNull()
    expect(toTaskStatus(3)).toBeNull()
  })
})

describe('sortTasks', () => {
  it('orders numerically, not lexically', () => {
    const out = sortTasks([task({ id: '10' }), task({ id: '9' }), task({ id: '2' })])
    expect(out.map((t) => t.id)).toEqual(['2', '9', '10'])
  })

  it('does not mutate its input', () => {
    const input = [task({ id: '10' }), task({ id: '9' })]
    sortTasks(input)
    expect(input.map((t) => t.id)).toEqual(['10', '9'])
  })

  it('files a non-numeric id after every numeric one, stably by string', () => {
    const out = sortTasks([task({ id: 'b' }), task({ id: '2' }), task({ id: 'a' })])
    expect(out.map((t) => t.id)).toEqual(['2', 'a', 'b'])
  })
})

describe('summarize', () => {
  it('counts completed against the total', () => {
    expect(
      summarize([
        task({ status: 'completed' }),
        task({ status: 'completed' }),
        task({ status: 'in_progress' }),
        task({ status: 'pending' }),
      ])
    ).toEqual({ completed: 2, total: 4 })
  })

  it('reports zero of zero for an empty list', () => {
    expect(summarize([])).toEqual({ completed: 0, total: 0 })
  })
})

describe('sameTasks', () => {
  it('is true for identical lists', () => {
    expect(sameTasks([task()], [task()])).toBe(true)
  })

  it('notices a status change', () => {
    expect(sameTasks([task()], [task({ status: 'completed' })])).toBe(false)
  })

  it('notices a subject change, so a renamed task redraws', () => {
    expect(sameTasks([task()], [task({ subject: 'Something else' })])).toBe(false)
  })

  it('notices a length change', () => {
    expect(sameTasks([task()], [task(), task({ id: '2' })])).toBe(false)
  })

  it('treats undefined and an empty list as the same nothing', () => {
    expect(sameTasks(undefined, [])).toBe(true)
    expect(sameTasks(undefined, undefined)).toBe(true)
    expect(sameTasks(undefined, [task()])).toBe(false)
  })
})
