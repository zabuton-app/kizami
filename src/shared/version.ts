/** Strip a leading "v"/"V" and surrounding whitespace. "v0.2.0" → "0.2.0". */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

/**
 * Whether a release tag looks like a version we can meaningfully compare.
 * `compareVersions` coerces non-numeric parts to 0, so an off-convention tag
 * ("latest", "v", "nightly") would silently compare as 0.0.0 and read as "you
 * are up to date". Such a tag means the check did not really succeed, so it is
 * rejected up front instead.
 */
export function isComparableVersion(raw: string): boolean {
  return /^\d+(\.\d+)*$/.test(normalizeVersion(raw).split('-')[0])
}

/**
 * Compare two stable dotted-numeric versions. Missing trailing components count
 * as 0, so "1.0" equals "1.0.0". Any pre-release suffix is dropped — only stable
 * releases are compared here. Returns >0 if `a` is newer, <0 if older, 0 if equal.
 *
 * Non-numeric components coerce to 0, which is fine because the release tags are
 * ours to control and follow the `v0.2.0` convention.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string): number[] =>
    normalizeVersion(version)
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)

  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}
