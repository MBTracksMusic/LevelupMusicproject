/**
 * Safely parse maintenance whitelist from environment variable.
 *
 * Handles all edge cases:
 * - undefined ENV → returns []
 * - empty string → returns []
 * - whitespace → trimmed and removed
 * - case-insensitivity → all emails lowercased
 *
 * @param envValue - Raw env variable value
 * @returns Array of whitelisted emails (lowercase)
 */
export function parseMaintenanceWhitelist(envValue?: string): string[] {
  if (!envValue || typeof envValue !== 'string') {
    return [];
  }

  return envValue
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}
