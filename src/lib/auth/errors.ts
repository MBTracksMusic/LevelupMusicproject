/**
 * Maps Supabase auth errors to a stable enum so UI code can switch on a single
 * value instead of inspecting fragile error messages.
 *
 * Sources of truth:
 * - https://supabase.com/docs/guides/auth/debugging/error-codes
 * - @supabase/supabase-js AuthError / AuthApiError classes
 */
export type AuthErrorKind =
  | 'session_missing'
  | 'session_not_found'
  | 'same_password'
  | 'weak_password'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'captcha_required'
  | 'expired_token'
  | 'invalid_token'
  | 'network'
  | 'unknown';

type LooseAuthError = {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
};

export function classifyAuthError(error: unknown): AuthErrorKind {
  if (!error) return 'unknown';

  const e = error as LooseAuthError;
  const name = (e.name ?? '').toString();
  const code = (e.code ?? '').toString().toLowerCase();
  const msg = (e.message ?? '').toString().toLowerCase();
  const status = typeof e.status === 'number' ? e.status : undefined;

  if (
    name === 'AuthSessionMissingError' ||
    msg.includes('auth session missing') ||
    msg.includes('session missing') ||
    msg.includes('session_missing')
  ) {
    return 'session_missing';
  }

  if (code === 'session_not_found' || msg.includes('session_not_found')) {
    return 'session_not_found';
  }

  if (
    code === 'same_password' ||
    msg.includes('new password should be different') ||
    msg.includes('same as the old password') ||
    msg.includes('same password')
  ) {
    return 'same_password';
  }

  if (
    code === 'weak_password' ||
    msg.includes('weak password') ||
    msg.includes('password is too weak') ||
    msg.includes('password should be at least') ||
    msg.includes('password should contain')
  ) {
    return 'weak_password';
  }

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'invalid_credentials';
  }

  if (
    status === 429 ||
    code.includes('rate_limit') ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    msg.includes('rate limit') ||
    msg.includes('too many')
  ) {
    return 'rate_limited';
  }

  if (
    code === 'captcha_failed' ||
    code === 'captcha_required' ||
    code === 'captcha_protected' ||
    msg.includes('captcha')
  ) {
    return 'captcha_required';
  }

  if (
    code === 'otp_expired' ||
    code === 'token_expired' ||
    msg.includes('token has expired') ||
    msg.includes('token is expired') ||
    msg.includes('otp expired')
  ) {
    return 'expired_token';
  }

  if (
    code === 'otp_disabled' ||
    code === 'bad_jwt' ||
    code === 'validation_failed' ||
    msg.includes('invalid token') ||
    msg.includes('invalid otp') ||
    msg.includes('token not found')
  ) {
    return 'invalid_token';
  }

  if (name === 'TypeError' && msg.includes('fetch')) {
    return 'network';
  }

  return 'unknown';
}

/**
 * Stable client-side password policy. Mirrors what we want the Supabase project
 * to require server-side; if Supabase is stricter, the server error message
 * will be surfaced via classifyAuthError → 'weak_password'.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireDigit: true,
} as const;

export function validatePasswordPolicy(password: string): { ok: boolean; reason?: 'too_short' | 'missing_upper' | 'missing_digit' } {
  if (password.length < PASSWORD_POLICY.minLength) return { ok: false, reason: 'too_short' };
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) return { ok: false, reason: 'missing_upper' };
  if (PASSWORD_POLICY.requireDigit && !/\d/.test(password)) return { ok: false, reason: 'missing_digit' };
  return { ok: true };
}
