/** Unit tests for the timeline arithmetic. Run: npm run test:ripple */
import { rippleOne, rippleDelete, normaliseRanges, clipSpan, clipEnd } from '../src/engine/ripple.ts'
import type { Clip } from '../src/types.ts'

let pass = 0, fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`) }
}
const clip = (o: Partial<Clip>): Clip =>
  ({ id: 'c', mediaId: 'm', track: 'video', start: 0, in: 0, out: 10, speed: 1, ...o })
const shape = (cs: Clip[]) =>
  cs.map((c) => [+c.start.toFixed(3), +clipEnd(c).toFixed(3), +c.in.toFixed(3), +c.out.toFixed(3)])

console.log('normaliseRanges')
eq('merges overlaps', normaliseRanges([{ start: 1, end: 3 }, { start: 2, end: 5 }]), [{ start: 1, end: 5 }])
eq('merges adjacent', normaliseRanges([{ start: 4, end: 6 }, { start: 0, end: 4 }]), [{ start: 0, end: 6 }])
eq('drops zero-width', normaliseRanges([{ start: 1, end: 1 }]), [])

console.log('\nrippleOne — single clip [0,10]')
eq('cut in middle splits and closes gap',
  shape(rippleOne([clip({})], [], 2, 4).clips), [[0, 2, 0, 2], [2, 8, 4, 10]])
eq('cut at head trims in-point',
  shape(rippleOne([clip({})], [], 0, 3).clips), [[0, 7, 3, 10]])
eq('cut at tail trims out-point',
  shape(rippleOne([clip({})], [], 7, 10).clips), [[0, 7, 0, 7]])
eq('cut entirely after leaves clip alone',
  shape(rippleOne([clip({})], [], 12, 14).clips), [[0, 10, 0, 10]])

console.log('\nrippleOne — downstream ripple')
eq('later clip shifts left by cut length',
  shape(rippleOne([clip({ start: 20, out: 5 })], [], 2, 4).clips), [[18, 23, 0, 5]])
eq('clip fully inside cut is dropped',
  shape(rippleOne([clip({ start: 3, out: 2 })], [], 1, 8).clips), [])

console.log('\nrippleOne — speed is respected')
// source [0,20] at 2x occupies 10s of timeline; cutting [2,4) must map to source [4,8)
eq('2x clip maps timeline cut into source time',
  shape(rippleOne([clip({ out: 20, speed: 2 })], [], 2, 4).clips), [[0, 2, 0, 4], [2, 8, 8, 20]])

console.log('\nrippleDelete — batch')
const batch = rippleDelete([clip({ out: 30 })], [], [
  { start: 25, end: 27 }, { start: 4, end: 6 }, { start: 10, end: 12 },
])
eq('three cuts leave four pieces', batch.clips.length, 4)
eq('total duration shrinks by exactly 6s',
  +batch.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0).toFixed(3), 24)
eq('source coverage stays contiguous',
  shape(batch.clips), [[0, 4, 0, 4], [4, 8, 6, 10], [8, 21, 12, 25], [21, 24, 27, 30]])
eq('reports what it did', [batch.cuts, +batch.removed.toFixed(3)], [3, 6])

console.log('\nzoom regions follow the cuts')
const z = rippleDelete([clip({ out: 30 })], [
  { id: 'z1', start: 20, end: 24, x: 0.5, y: 0.5, scale: 2 },
  { id: 'z2', start: 4, end: 6, x: 0.5, y: 0.5, scale: 2 },
], [{ start: 4, end: 6 }])
eq('zoom after the cut shifts left', [z.zooms[0].start, z.zooms[0].end], [18, 22])
eq('zoom collapsed by the cut is dropped', z.zooms.length, 1)

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
