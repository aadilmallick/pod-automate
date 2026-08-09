export type Point = [number, number]
export type Quad = [Point, Point, Point, Point]
export type Matrix3 = [number, number, number, number, number, number, number, number, number]

export function quadArea(points: Quad) {
  return Math.abs(points.reduce((area, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]
    return area + x * nextY - nextX * y
  }, 0) / 2)
}

export function isConvexQuad(points: Quad) {
  if (quadArea(points) < 1e-8) return false
  const turns = points.map((point, index) => {
    const next = points[(index + 1) % 4]
    const after = points[(index + 2) % 4]
    return (next[0] - point[0]) * (after[1] - next[1]) - (next[1] - point[1]) * (after[0] - next[0])
  })
  const nonZero = turns.filter((turn) => Math.abs(turn) > 1e-8)
  if (nonZero.length !== 4) return false
  const sign = Math.sign(nonZero[0])
  return nonZero.every((turn) => Math.sign(turn) === sign)
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const a = matrix.map((row, index) => [...row, values[index]])
  for (let column = 0; column < 8; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 8; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row
    if (Math.abs(a[pivot][column]) < 1e-10) throw new Error('Degenerate quadrilateral')
    ;[a[column], a[pivot]] = [a[pivot], a[column]]
    const divisor = a[column][column]
    for (let item = column; item <= 8; item += 1) a[column][item] /= divisor
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue
      const factor = a[row][column]
      for (let item = column; item <= 8; item += 1) a[row][item] -= factor * a[column][item]
    }
  }
  return a.map((row) => row[8])
}

export function computeHomography(source: Quad, destination: Quad): Matrix3 {
  const matrix: number[][] = []
  const values: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const [sx, sy] = source[index]
    const [dx, dy] = destination[index]
    matrix.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy])
    values.push(dx)
    matrix.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy])
    values.push(dy)
  }
  const [h00, h01, h02, h10, h11, h12, h20, h21] = solveLinearSystem(matrix, values)
  return [h00, h01, h02, h10, h11, h12, h20, h21, 1]
}

export function invertHomography(matrix: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = matrix
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(determinant) < 1e-10) throw new Error('Non-invertible homography')
  return [
    (e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant,
    (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant,
    (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant,
  ]
}

export function project(matrix: Matrix3, point: Point): Point {
  const [x, y] = point
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8]
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / denominator, (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator]
}

function bilinear(source: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, x: number, y: number) {
  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(y)))
  const x1 = Math.min(source.width - 1, x0 + 1)
  const y1 = Math.min(source.height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const result = [0, 0, 0, 0]
  for (let channel = 0; channel < 4; channel += 1) {
    const top = source.data[(y0 * source.width + x0) * 4 + channel] * (1 - fx) + source.data[(y0 * source.width + x1) * 4 + channel] * fx
    const bottom = source.data[(y1 * source.width + x0) * 4 + channel] * (1 - fx) + source.data[(y1 * source.width + x1) * 4 + channel] * fx
    result[channel] = top * (1 - fy) + bottom * fy
  }
  return result
}

export function warpRgbaToCanvas(source: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, destinationWidth: number, destinationHeight: number, destination: Quad) {
  const sourceQuad: Quad = [[0, 0], [source.width - 1, 0], [source.width - 1, source.height - 1], [0, source.height - 1]]
  const inverse = invertHomography(computeHomography(sourceQuad, destination))
  const output = new Uint8ClampedArray(destinationWidth * destinationHeight * 4)
  const minX = Math.max(0, Math.floor(Math.min(...destination.map((point) => point[0]))))
  const maxX = Math.min(destinationWidth - 1, Math.ceil(Math.max(...destination.map((point) => point[0]))))
  const minY = Math.max(0, Math.floor(Math.min(...destination.map((point) => point[1]))))
  const maxY = Math.min(destinationHeight - 1, Math.ceil(Math.max(...destination.map((point) => point[1]))))
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const [sourceX, sourceY] = project(inverse, [x + 0.5, y + 0.5])
    if (sourceX < 0 || sourceY < 0 || sourceX > source.width - 1 || sourceY > source.height - 1) continue
    const pixel = bilinear(source, sourceX, sourceY)
    const offset = (y * destinationWidth + x) * 4
    output[offset] = pixel[0]
    output[offset + 1] = pixel[1]
    output[offset + 2] = pixel[2]
    output[offset + 3] = pixel[3]
  }
  return output
}
