import { describe, it, expect } from 'vitest'
import {
  ancestorPids,
  parseBtime,
  parseComm,
  parsePpid,
  parseStartTicks,
} from '../../src/core/procParse.js'

describe('parsePpid', () => {
  it('reads the ppid field from a normal stat line', () => {
    expect(parsePpid('1234 (bash) S 1000 1234 1234 34816 ...')).toBe(1000)
  })

  it('survives a comm containing spaces and parentheses', () => {
    expect(parsePpid('4242 (my weird (proc)) S 99 4242 ...')).toBe(99)
  })

  it('returns null for junk', () => {
    expect(parsePpid('')).toBeNull()
    expect(parsePpid('no parens here')).toBeNull()
    expect(parsePpid('1234 (bash) S notanumber')).toBeNull()
  })
})

describe('ancestorPids', () => {
  const tree: Record<number, number> = { 500: 400, 400: 300, 300: 1, 1: 0 }
  const readStat = (pid: number) =>
    tree[pid] === undefined ? null : `${pid} (proc) S ${tree[pid]} rest`

  it('walks from the leaf up to init, including the leaf', () => {
    expect(ancestorPids(500, readStat)).toEqual([500, 400, 300, 1])
  })

  it('stops at an unreadable pid', () => {
    expect(ancestorPids(999, readStat)).toEqual([999])
  })

  it('respects the depth cap', () => {
    expect(ancestorPids(500, readStat, 2)).toEqual([500, 400])
  })

  it('stops on a cycle rather than looping forever', () => {
    const cyclic = (pid: number) => (pid === 7 ? '7 (a) S 8 x' : '8 (b) S 7 x')
    expect(ancestorPids(7, cyclic)).toEqual([7, 8])
  })

  it('returns an empty array for pid zero', () => {
    expect(ancestorPids(0, readStat)).toEqual([])
  })
})

describe('parseComm', () => {
  it('reads comm from a normal stat line', () => {
    expect(parseComm('1234 (claude) S 1000 1234 ...')).toBe('claude')
  })

  it('survives a comm containing spaces and parentheses', () => {
    expect(parseComm('4242 (my weird (proc)) S 99 4242 ...')).toBe('my weird (proc)')
  })

  it('returns null for junk', () => {
    expect(parseComm('')).toBeNull()
    expect(parseComm('no parens here')).toBeNull()
    expect(parseComm('1234 )backwards( S 1')).toBeNull()
  })
})

describe('parseStartTicks', () => {
  // Fields 3..22 after the closing paren: state, ppid, pgrp, session, tty_nr,
  // tpgid, flags, minflt, cminflt, majflt, cmajflt, utime, stime, cutime,
  // cstime, priority, nice, num_threads, itrealvalue, starttime.
  const stat = (starttime: number) =>
    `1234 (claude) S 1000 1234 1234 34816 1234 4194304 900 0 0 0 12 3 0 0 20 0 14 0 ${starttime} 123456 ...`

  it('reads starttime, field 22', () => {
    expect(parseStartTicks(stat(987654))).toBe(987654)
  })

  it('survives a comm containing spaces and parentheses', () => {
    expect(parseStartTicks(stat(11).replace('(claude)', '(my weird (proc))'))).toBe(11)
  })

  it('returns null when the line is too short or unparseable', () => {
    expect(parseStartTicks('1234 (claude) S 1000 1234')).toBeNull()
    expect(parseStartTicks('')).toBeNull()
    expect(
      parseStartTicks(
        '1234 (claude) S 1000 1234 1234 34816 1234 4194304 900 0 0 0 12 3 0 0 20 0 14 0 nope 999'
      )
    ).toBeNull()
  })
})

describe('parseBtime', () => {
  const procStat = 'cpu  1 2 3\ncpu0 1 2 3\nintr 99\nctxt 12345\nbtime 1753000000\nprocesses 700\n'

  it('reads the btime line', () => {
    expect(parseBtime(procStat)).toBe(1753000000)
  })

  it('returns null when there is no btime line', () => {
    expect(parseBtime('cpu  1 2 3\nctxt 12345\n')).toBeNull()
  })

  it('returns null for a non-numeric or zero btime', () => {
    expect(parseBtime('btime later\n')).toBeNull()
    expect(parseBtime('btime 0\n')).toBeNull()
  })
})
