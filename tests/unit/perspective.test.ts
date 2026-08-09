import { describe, expect, it } from 'vitest'
import { computeHomography, invertHomography, isConvexQuad, project, type Quad } from '../../src/core/perspective'

describe('perspective helpers', () => {
  it('accepts a convex clockwise or counter-clockwise quad and rejects crossed points', () => {
    expect(isConvexQuad([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(true)
    expect(isConvexQuad([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(false)
  })

  it('round trips the four corners through a projective mapping', () => {
    const source: Quad = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const destination: Quad = [[10, 12], [92, 5], [96, 108], [4, 101]]
    const matrix = computeHomography(source, destination)
    const inverse = invertHomography(matrix)
    for (let index = 0; index < source.length; index += 1) {
      const mapped = project(matrix, source[index])
      const restored = project(inverse, mapped)
      expect(mapped[0]).toBeCloseTo(destination[index][0], 5)
      expect(mapped[1]).toBeCloseTo(destination[index][1], 5)
      expect(restored[0]).toBeCloseTo(source[index][0], 5)
      expect(restored[1]).toBeCloseTo(source[index][1], 5)
    }
  })
})
