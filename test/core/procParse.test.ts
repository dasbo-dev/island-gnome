import { describe, it, expect } from 'vitest'
import { ancestorPids, parsePpid } from '../../src/core/procParse.js'

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
