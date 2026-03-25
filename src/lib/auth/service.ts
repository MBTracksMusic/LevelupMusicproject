import type { AuthResponse, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { clearAnalyticsUserId } from '../analytics';
import { getAuthRedirectUrl } from './redirects';

export interface SignUpData {
  email: string;
  password: string;
  username?: string;
  fullName?: string;
}

export interface SignInData {
  email: string;
  password: string;
}

type AuthFunctionResponse = {
  user: User | null;
  session: Session | null;
};

type AuthFunctionResetResponse = {
  ok: boolean;
};

export class AuthFunctionError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'AuthFunctionError';
    this.status = status;
    this.code = code;
  }
}

async function parseFunctionInvokeError(error: unknown) {
  let message = error instanceof Error ? error.message : 'Request failed';
  let status: number | undefined;
  let code: string | undefined;

  try {
    const context = (error as {
      context?: {
        status?: number;
        json?: () => Promise<{ error?: string; message?: string }>;
      };
    }).context;
    status = typeof context?.status === 'number' ? context.status : undefined;
    const payload = await context?.json?.();
    if (payload?.message) {
      message = payload.message;
    }
    if (payload?.error) {
      code = payload.error;
    }
  } catch {
    // Ignore invoke parsing failures and keep the original error message.
  }

  return new AuthFunctionError(message, status, code);
}

async function invokeAuthFunction<T>(functionName: string, body: Record<string, unknown>) {
  console.log(`[auth] Invoking function: ${functionName}`, {
    bodyKeys: Object.keys(body),
    url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`
  });

  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    body,
    method: 'POST',
  });

  if (error) {
    console.error(`[auth] Function ${functionName} error:`, {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorContext: (error as any)?.context,
    });
    throw await parseFunctionInvokeError(error);
  }

  console.log(`[auth] Function ${functionName} success`);

  if (data == null) {
    throw new AuthFunctionError(`Empty response from ${functionName}`);
  }

  return data;
}

async function hydrateBrowserSession(authResponse: AuthFunctionResponse): Promise<AuthResponse['data']> {
  if (authResponse.session?.access_token && authResponse.session?.refresh_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: authResponse.session.access_token,
      refresh_token: authResponse.session.refresh_token,
    });

    if (error) {
      throw error;
    }

    return data;
  }

  return {
    user: authResponse.user,
    session: authResponse.session,
  };
}

export async function signUp({ email, password, username, fullName, captchaToken }: SignUpData & { captchaToken: string }) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = (username ?? cleanEmail.split('@')[0]).trim();
  const cleanFullName = fullName?.trim() || undefined;

  const data = await invokeAuthFunction<AuthFunctionResponse>('auth-signup', {
    email: cleanEmail,
    password,
    username: cleanUsername,
    fullName: cleanFullName,
    captchaToken,
    redirectTo: getAuthRedirectUrl('/email-confirmation'),
  });

  return await hydrateBrowserSession(data);
}

export async function signIn({ email, password, captchaToken }: SignInData & { captchaToken: string }) {
  const data = await invokeAuthFunction<AuthFunctionResponse>('auth-login', {
    email,
    password,
    captchaToken,
  });

  return await hydrateBrowserSession(data);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  clearAnalyticsUserId();
}

export async function resetPassword(email: string, captchaToken: string) {
  const data = await invokeAuthFunction<AuthFunctionResetResponse>('auth-forgot-password', {
    email,
    captchaToken,
    redirectTo: getAuthRedirectUrl('/reset-password'),
  });

  if (!data?.ok) {
    throw new AuthFunctionError('Unable to trigger password reset');
  }
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
}

export async function updateProfile(updates: {
  username?: string;
  full_name?: string;
  avatar_url?: string;
  bio?: string;
  website_url?: string;
  language?: 'fr' | 'en' | 'de';
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const sanitizedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  );
  const updatePayload = {
    ...sanitizedUpdates,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_profiles')
    .update(updatePayload as never)
    .eq('id', user.id);

  if (error) throw error;
}
