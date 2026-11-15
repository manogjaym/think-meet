import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveResponsiveCss } from '../scripts/responsive.mjs'

test('a shared breakpoint change updates both max-width and adjacent min-width without editing CSS', () => {
  const css = '@media(max-width:design(layout.prejoinWide)){.a{color:red}} @media(min-width:design(layout.prejoinWide + 1)){.a{color:blue}}'
  assert.equal(resolveResponsiveCss(css, { prejoinWide: 850 }), '@media(max-width:850px){.a{color:red}} @media(min-width:851px){.a{color:blue}}')
  assert.equal(resolveResponsiveCss(css, { prejoinWide: 900 }), '@media(max-width:900px){.a{color:red}} @media(min-width:901px){.a{color:blue}}')
  assert.throws(() => resolveResponsiveCss(css, {}), /Missing shared responsive token/)
})
