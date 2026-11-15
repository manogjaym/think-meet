import { brandPaths } from "../generated/design-vectors"

/** Exact shared book mark; edit design/assets/vectors.json for both web and native. */
export function BrandSymbol() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {brandPaths.map((d, index) => <path key={index} d={d} />)}
    </svg>
  )
}
