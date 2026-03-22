export function getEarlyAccessDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isEarlyAccessActive(value?: string | null, now = new Date()) {
  const earlyAccessDate = getEarlyAccessDate(value);
  if (!earlyAccessDate) {
    return false;
  }

  return earlyAccessDate.getTime() > now.getTime();
}

export function isEarlyAccessLocked(value: string | null | undefined, hasPremiumAccess: boolean) {
  return isEarlyAccessActive(value) && !hasPremiumAccess;
}
