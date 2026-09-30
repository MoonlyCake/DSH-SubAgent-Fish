#!/usr/bin/env node
/** Pixel regressions for the dependency-free PNG reader and GIF writer. */
import assert from 'node:assert/strict'
import { decodePng } from './png.mjs'
import { encodeGif } from './gif.js'

// Valid PNGs independently encoded by Pillow 12.3.0, using Image.save(PNG).
// RGB / RGBA are 2×2: red, blue, white, black. The RGB+tRNS fixture is
// 2×1: red explicitly marked transparent, followed by opaque blue.
const pngFixtures = [
  {
    name: 'opaque RGB', width: 2, height: 2,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwPCf4f9/EAMAI+oE/MdFdZgAAAAASUVORK5CYII=',
    rgba: [255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255],
  },
  {
    name: 'RGBA preserves partial alpha', width: 2, height: 2,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4zwAC/x0Y/v//3wBiAQA24Aa7NwOgPAAAAABJRU5ErkJggg==',
    rgba: [255, 0, 0, 0, 0, 0, 255, 64, 255, 255, 255, 128, 0, 0, 0, 255],
  },
  {
    name: 'RGB transparent colour key', width: 2, height: 1,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAABnRSTlMA/wAAAACkwsAdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC',
    rgba: [255, 0, 0, 0, 0, 0, 255, 255],
  },
]
for (const fixture of pngFixtures) {
  const actual = decodePng(Buffer.from(fixture.base64, 'base64'))
  assert.equal(actual.width, fixture.width)
  assert.equal(actual.height, fixture.height)
  assert.deepEqual([...actual.rgba], fixture.rgba)
  console.log(`  ok   PNG ${fixture.name}`)
}

/** Independent GIF LZW reader: dictionary entries are byte arrays, unlike
 * the encoder's prefix/suffix lookup table. Checks code-width changes/clears. */
function decodeLzw(bytes, minimum, expectedPixels) {
  const clear = 1 << minimum, end = clear + 1
  let table, next, bits, previous, at = 0
  const reset = () => {
    table = Array.from({ length: clear }, (_, index) => [index])
    next = end + 1
    bits = minimum + 1
    previous = undefined
  }
  const read = () => {
    assert.ok(at + bits <= bytes.length * 8, 'GIF LZW stream is not truncated')
    let code = 0
    for (let i = 0; i < bits; i++, at++) code |= ((bytes[at >> 3] >> (at & 7)) & 1) << i
    return code
  }
  const output = []
  reset()
  while (true) {
    const code = read()
    if (code === clear) { reset(); continue }
    if (code === end) break
    const entry = table[code] ?? (code === next && previous ? [...previous, previous[0]] : undefined)
    assert.ok(entry, `valid LZW dictionary code ${code}`)
    output.push(...entry)
    if (previous) {
      table[next++] = [...previous, entry[0]]
      if (next === 1 << bits && bits < 12) bits += 1
    }
    previous = entry
  }
  assert.equal(output.length, expectedPixels)
  return output
}

function decodeGif(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 6)).toString(), 'GIF89a')
  const u16 = (at) => bytes[at] | bytes[at + 1] << 8
  const width = u16(6), height = u16(8)
  assert.ok(bytes[10] & 0x80, 'global colour table is present')
  const paletteLength = 3 * (1 << ((bytes[10] & 7) + 1))
  const palette = bytes.subarray(13, 13 + paletteLength)
  let at = 13 + paletteLength, control
  const frames = []
  const readBlocks = () => {
    const result = []
    while (bytes[at] !== 0) {
      const length = bytes[at++]
      result.push(...bytes.subarray(at, at + length))
      at += length
    }
    at += 1
    return result
  }
  while (bytes[at] !== 0x3b) {
    const type = bytes[at++]
    if (type === 0x21) {
      const label = bytes[at++]
      if (label === 0xf9) {
        assert.equal(bytes[at++], 4)
        control = { flags: bytes[at], delay: u16(at + 1), transparent: bytes[at + 3] }
        at += 4
        assert.equal(bytes[at++], 0)
      } else readBlocks()
      continue
    }
    assert.equal(type, 0x2c, 'image descriptor follows extensions')
    assert.equal(u16(at), 0)
    assert.equal(u16(at + 2), 0)
    assert.equal(u16(at + 4), width)
    assert.equal(u16(at + 6), height)
    assert.equal(bytes[at + 8], 0, 'frames use the global palette without interlacing')
    at += 9
    const minimum = bytes[at++]
    const indices = decodeLzw(readBlocks(), minimum, width * height)
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i], offset = i * 4
      rgba.set(palette.subarray(index * 3, index * 3 + 3), offset)
      rgba[offset + 3] = control.flags & 1 && index === control.transparent ? 0 : 255
    }
    frames.push({ rgba, delay: control.delay, disposal: (control.flags >> 2) & 7 })
  }
  assert.equal(at + 1, bytes.length, 'GIF ends at the trailer')
  return { width, height, frames }
}

let state = 0x12345678
const randomByte = () => {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return (state >>> 0) % 255
}
for (const spec of [
  { name: 'transparent moving pixels', width: 2, height: 1, frames: [
    new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]),
    new Uint8ClampedArray([255, 0, 0, 127, 0, 0, 255, 128]),
  ] },
  { name: 'LZW width growth and dictionary resets', width: 128, height: 64, frames:
    Array.from({ length: 2 }, () => {
      const frame = new Uint8ClampedArray(128 * 64 * 4)
      for (let i = 0; i < frame.length; i += 4) {
        const colour = randomByte()
        frame.set([colour, (colour * 71) % 256, (colour * 31) % 256, 255], i)
      }
      return frame
    }),
  },
]) {
  const encoded = encodeGif({ ...spec, delay: 13, loop: 3 })
  const actual = decodeGif(encoded)
  assert.equal(actual.width, spec.width)
  assert.equal(actual.height, spec.height)
  assert.equal(actual.frames.length, spec.frames.length)
  for (let i = 0; i < spec.frames.length; i++) {
    const expected = spec.frames[i], frame = actual.frames[i]
    assert.equal(frame.delay, 13)
    assert.equal(frame.disposal, 2)
    for (let offset = 0; offset < expected.length; offset += 4) {
      const alpha = expected[offset + 3] < 128 ? 0 : 255
      assert.equal(frame.rgba[offset + 3], alpha)
      if (alpha) assert.deepEqual([...frame.rgba.subarray(offset, offset + 3)], [...expected.subarray(offset, offset + 3)])
    }
  }
  console.log(`  ok   GIF ${spec.name}`)
}

console.log('\nimage pixel checks passed')
