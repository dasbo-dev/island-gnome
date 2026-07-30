import { describe, it, expect } from 'vitest'
import { bodyMaxHeight, scrollIntoView, MIN_BODY } from '../../src/core/popupSize.js'

describe('bodyMaxHeight', () => {
  it('takes 90% of the work area less the chrome', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: 1 })).toBe(800)
  })

  it('honours an explicit fraction', () => {
    expect(
      bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 0, scaleFactor: 1, fraction: 0.5 })
    ).toBe(500)
  })

  // The work area is in physical pixels while St multiplies CSS lengths — such
  // as max-height — by the scale factor, so an unscaled max-height would let
  // the body grow to twice the cap on a 2x monitor.
  it('divides by the scale factor', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: 2 })).toBe(400)
  })

  it('returns whole pixels', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1001, chromeHeight: 0, scaleFactor: 1 })).toBe(900)
  })

  it('floors at MIN_BODY when the chrome eats the whole cap', () => {
    expect(bodyMaxHeight({ workAreaHeight: 200, chromeHeight: 1000, scaleFactor: 1 })).toBe(MIN_BODY)
  })

  it('treats an unusable scale factor as 1 rather than dividing by zero', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: 0 })).toBe(800)
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: NaN })).toBe(800)
  })
})

describe('scrollIntoView', () => {
  it('leaves a fully visible child alone', () => {
    expect(scrollIntoView({ value: 0, pageSize: 200, childY: 10, childHeight: 20 })).toBe(0)
  })

  it('scrolls up to a child above the viewport', () => {
    expect(scrollIntoView({ value: 100, pageSize: 200, childY: 40, childHeight: 20 })).toBe(40)
  })

  it('scrolls down until a child below the viewport is flush with the bottom', () => {
    expect(scrollIntoView({ value: 0, pageSize: 200, childY: 300, childHeight: 50 })).toBe(150)
  })

  it('aligns a child taller than the page to its top', () => {
    expect(scrollIntoView({ value: 0, pageSize: 100, childY: 300, childHeight: 400 })).toBe(300)
  })
})
