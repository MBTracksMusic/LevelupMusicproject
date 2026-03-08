import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import type { UserProfile } from '../supabase/types';
import { supabase } from '../supabase/client';
import { resolveInitialLanguage, syncI18nLanguage } from '../i18n';

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isInitialized: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  fetchProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const normalizeProducerTier = (value: unknown): UserProfile['producer_tier'] => {
  if (value === 'elite') return 'elite';
  if (value === 'pro' || value === 'producteur') return 'pro';
  if (value === 'starter' || value === 'user') return 'starter';
  return null;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isLoading: true,
  isInitialized: false,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  setInitialized: (isInitialized) => set({ isInitialized }),

  fetchProfile: async () => {
    const { user } = get();
    if (!user) {
      profileFetchUserId = null;
      profileFetchInFlight = null;
      set({ profile: null });
      syncI18nLanguage();
      return;
    }

    if (profileFetchInFlight && profileFetchUserId === user.id) {
      await profileFetchInFlight;
      return;
    }

    const fetchPromise = (async () => {
      const { data, error } = await supabase
        .from('my_user_profile')
        .select('id, user_id, username, full_name, avatar_url, role, producer_tier, is_producer_active, is_deleted, deleted_at, delete_reason, deleted_label, total_purchases, confirmed_at, producer_verified_at, battle_refusal_count, battles_participated, battles_completed, engagement_score, language, bio, website_url, social_links, created_at, updated_at')
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile:', error);
        syncI18nLanguage();
        return;
      }

      if (!data) {
        set({ profile: null });
        syncI18nLanguage();
        return;
      }

      const row = data as Record<string, unknown>;
      const resolvedLanguage = resolveInitialLanguage(row.language);
      const isDeletedAccount = row.is_deleted === true || typeof row.deleted_at === 'string';

      if (isDeletedAccount) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.error('Error signing out deleted account:', signOutError);
        }
        set({ user: null, session: null, profile: null });
        syncI18nLanguage();
        return;
      }

      set({
        profile: {
          id: typeof row.id === 'string' && row.id.length > 0 ? row.id : user.id,
          email: user.email ?? '',
          username: typeof row.username === 'string' ? row.username : null,
          full_name: typeof row.full_name === 'string' ? row.full_name : null,
          avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null,
          role:
            row.role === 'visitor' ||
            row.role === 'user' ||
            row.role === 'confirmed_user' ||
            row.role === 'producer' ||
            row.role === 'admin'
              ? row.role
              : 'user',
          is_confirmed: row.confirmed_at != null,
          is_producer_active: row.is_producer_active === true,
          producer_tier: normalizeProducerTier(row.producer_tier),
          stripe_customer_id: null,
          stripe_subscription_id: null,
          subscription_status: null,
          total_purchases: typeof row.total_purchases === 'number' ? row.total_purchases : 0,
          confirmed_at: typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
          producer_verified_at: typeof row.producer_verified_at === 'string' ? row.producer_verified_at : null,
          battle_refusal_count: typeof row.battle_refusal_count === 'number' ? row.battle_refusal_count : 0,
          battles_participated: typeof row.battles_participated === 'number' ? row.battles_participated : 0,
          battles_completed: typeof row.battles_completed === 'number' ? row.battles_completed : 0,
          engagement_score: typeof row.engagement_score === 'number' ? row.engagement_score : 0,
          language: resolvedLanguage,
          bio: typeof row.bio === 'string' ? row.bio : null,
          website_url: typeof row.website_url === 'string' ? row.website_url : null,
          social_links:
            row.social_links && typeof row.social_links === 'object' && !Array.isArray(row.social_links)
              ? (row.social_links as Record<string, string>)
              : {},
          is_deleted: row.is_deleted === true,
          deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
          delete_reason: typeof row.delete_reason === 'string' ? row.delete_reason : null,
          deleted_label: typeof row.deleted_label === 'string' ? row.deleted_label : null,
          created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
          updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
        } satisfies UserProfile,
      });

      syncI18nLanguage(resolvedLanguage);
    })();

    profileFetchUserId = user.id;
    profileFetchInFlight = fetchPromise;

    try {
      await fetchPromise;
    } finally {
      if (profileFetchInFlight === fetchPromise) {
        profileFetchInFlight = null;
      }

      if (profileFetchUserId === user.id) {
        profileFetchUserId = null;
      }
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, profile: null });
  },
}));

let nextAuthInitId = 0;
let activeAuthInitId = 0;
let profileFetchInFlight: Promise<void> | null = null;
let profileFetchUserId: string | null = null;

export function initializeAuth() {
  const initId = ++nextAuthInitId;
  activeAuthInitId = initId;
  let isDisposed = false;
  const { setUser, setSession, setLoading, setInitialized, fetchProfile } = useAuthStore.getState();

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (isDisposed || activeAuthInitId !== initId) {
      return;
    }

    const currentState = useAuthStore.getState();
    const isSameSession =
      currentState.session?.access_token === session?.access_token &&
      currentState.user?.id === session?.user?.id;

    setSession(session);
    setUser(session?.user ?? null);
    if (session?.user && (!isSameSession || !currentState.profile || profileFetchInFlight)) {
      void fetchProfile();
    } else {
      syncI18nLanguage();
    }
    setLoading(false);
    setInitialized(true);
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') {
      return;
    }

    (async () => {
      if (isDisposed || activeAuthInitId !== initId) {
        return;
      }

      const currentState = useAuthStore.getState();
      const isSameSession =
        currentState.session?.access_token === session?.access_token &&
        currentState.user?.id === session?.user?.id;

      if (isSameSession && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile();
      } else {
        useAuthStore.setState({ profile: null });
        syncI18nLanguage();
      }

      if (isDisposed || activeAuthInitId !== initId) {
        return;
      }

      setLoading(false);
    })();
  });

  return () => {
    isDisposed = true;
    if (activeAuthInitId === initId) {
      activeAuthInitId = 0;
    }
    subscription.unsubscribe();
  };
}
