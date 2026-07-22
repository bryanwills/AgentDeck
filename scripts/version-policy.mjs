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

export function compatibilityLine(value) {
  const version = parseNumericVersion(value);
  return version ? `${version.major}.${version.minor}` : null;
}

// Product compatibility is intentionally independent of patch ordering.
// 1.0.9 works with 1.0.1 in both directions; 1.1.0 requires coordination.
export function areVersionsCompatible(left, right) {
  const leftVersion = parseNumericVersion(left);
  const rightVersion = parseNumericVersion(right);
  return Boolean(
    leftVersion && rightVersion && leftVersion.major === rightVersion.major && leftVersion.minor === rightVersion.minor,
  );
}
