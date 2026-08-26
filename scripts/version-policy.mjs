const NUMERIC_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseNumericVersion(value) {
  const match = NUMERIC_SEMVER.exec(value ?? '');
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compatibilityMajor(value) {
  const version = parseNumericVersion(value);
  return version ? `${version.major}` : null;
}

// Product compatibility is intentionally independent of minor/patch ordering.
// Minor versions add backward-compatible features, so 1.1.0 works with 1.0.9
// in both directions. A major bump is the coordinated compatibility boundary.
export function areVersionsCompatible(left, right) {
  const leftVersion = parseNumericVersion(left);
  const rightVersion = parseNumericVersion(right);
  return Boolean(leftVersion && rightVersion && leftVersion.major === rightVersion.major);
}
