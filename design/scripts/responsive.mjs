/** CSS media queries cannot use custom properties; resolve their shared layout tokens before Vite CSS processing. */
export function resolveResponsiveCss(css, layout) {
  return css.replace(/design\((layout\.[A-Za-z][A-Za-z0-9]*)(?:\s*\+\s*(\d+))?\)/g, (_, name, delta = '0') => {
    const value = layout[name.slice('layout.'.length)]
    if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`Missing shared responsive token: ${name}`)
    return `${value + Number(delta)}px`
  })
}
