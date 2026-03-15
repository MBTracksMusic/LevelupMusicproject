import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, Instagram, Twitter, Users, Youtube } from 'lucide-react';
import { ReputationBadge, formatRankTier } from '../components/reputation/ReputationBadge';
import { useTranslation } from '../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import type { ProducerTier, ReputationRankTier } from '../lib/supabase/types';
import { formatPrice } from '../lib/utils/format';

interface PublicProducerProfile {
  user_id: string;
  raw_username: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  social_links: Record<string, string> | null;
  producer_tier: ProducerTier | null;
  xp: number;
  level: number;
  rank_tier: ReputationRankTier;
  reputation_score: number;
  is_deleted: boolean;
  created_at: string;
}

interface PublicProducerBeat {
  id: string;
  title: string;
  slug: string;
  cover_image_url: string | null;
  price: number;
  bpm: number | null;
  key_signature: string | null;
  created_at: string;
}

interface PublicProducerBattle {
  id: string;
  title: string;
  slug: string;
  status: string;
  winner_id: string | null;
  producer1_id: string;
  producer2_id: string | null;
  created_at: string;
}

const normalizeSocialUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const toSocialLinks = (raw: unknown): Array<{ key: 'twitter' | 'instagram' | 'youtube'; href: string }> => {
  if (!raw || typeof raw !== 'object') return [];

  const source = raw as Record<string, unknown>;
  const keys: Array<'twitter' | 'instagram' | 'youtube'> = ['twitter', 'instagram', 'youtube'];

  return keys
    .map((key) => {
      const value = source[key];
      if (typeof value !== 'string') return null;
      const href = normalizeSocialUrl(value);
      if (!href) return null;
      return { key, href };
    })
    .filter((item): item is { key: 'twitter' | 'instagram' | 'youtube'; href: string } => item !== null);
};

const getProducerTierLabel = (tier: ProducerTier | null, t: ReturnType<typeof useTranslation>['t']) => {
  if (tier === 'elite') return t('producerProfile.tierElite');
  if (tier === 'pro') return t('producerProfile.tierPro');
  return t('producerProfile.tierStarter');
};

export function ProducerPublicProfilePage() {
  const { t } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const [producer, setProducer] = useState<PublicProducerProfile | null>(null);
  const [beats, setBeats] = useState<PublicProducerBeat[]>([]);
  const [battles, setBattles] = useState<PublicProducerBattle[]>([]);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isBeatsLoading, setIsBeatsLoading] = useState(false);
  const [isBattlesLoading, setIsBattlesLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [beatsError, setBeatsError] = useState<string | null>(null);
  const [battlesError, setBattlesError] = useState<string | null>(null);
  const [isDeletedProfile, setIsDeletedProfile] = useState(false);

  const socialLinks = useMemo(() => toSocialLinks(producer?.social_links), [producer?.social_links]);

  useEffect(() => {
    let isCancelled = false;

    const fetchPublicProducer = async () => {
      if (!username) {
        setProfileError(t('producerProfile.missingUsername'));
        setIsProfileLoading(false);
        return;
      }

      setIsProfileLoading(true);
      setProfileError(null);
      setBeatsError(null);
      setBattlesError(null);
      setIsDeletedProfile(false);
      setBeats([]);
      setBattles([]);

      try {
        const lookup = username.trim().toLowerCase();
        const isUuidLookup = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(username);
        const matchesLookup = (row: Record<string, unknown>) => {
          const candidates = [row.raw_username, row.username, row.user_id];
          return candidates.some((value) => typeof value === 'string' && value.trim().toLowerCase() === lookup);
        };

        let producerRecord: Record<string, unknown> | null = null;

        const visibleRpcRes = await supabase.rpc('get_public_visible_producer_profiles' as any);
        if (!visibleRpcRes.error && Array.isArray(visibleRpcRes.data)) {
          const row = (visibleRpcRes.data as Array<Record<string, unknown>>).find(matchesLookup);
          if (row) {
            producerRecord = row;
          }
        }

        if (!producerRecord) {
          const softRpcRes = await supabase.rpc('get_public_producer_profiles_soft' as any);
          if (!softRpcRes.error && Array.isArray(softRpcRes.data)) {
            const row = (softRpcRes.data as Array<Record<string, unknown>>).find(matchesLookup);
            if (row) {
              producerRecord = row;
            }
          }
        }

        if (!producerRecord) {
          const v2RpcRes = await supabase.rpc('get_public_producer_profiles_v2');
          if (!v2RpcRes.error && Array.isArray(v2RpcRes.data)) {
            const row = (v2RpcRes.data as Array<Record<string, unknown>>).find(matchesLookup);
            if (row) {
              producerRecord = {
                ...row,
                raw_username: typeof row.username === 'string' ? row.username : null,
                is_deleted: false,
              };
            }
          }
        }

        if (!producerRecord) {
          const byRawUsername = await supabase
            .from('public_producer_profiles')
            .select('user_id, raw_username, username, avatar_url, bio, social_links, producer_tier, xp, level, rank_tier, reputation_score, is_deleted, created_at')
            .eq('raw_username', username)
            .limit(1)
            .maybeSingle();
          if (!byRawUsername.error && byRawUsername.data) {
            producerRecord = byRawUsername.data as unknown as Record<string, unknown>;
          }
        }

        if (!producerRecord) {
          const byUsername = await supabase
            .from('public_producer_profiles')
            .select('user_id, raw_username, username, avatar_url, bio, social_links, producer_tier, xp, level, rank_tier, reputation_score, is_deleted, created_at')
            .eq('username', username)
            .limit(1)
            .maybeSingle();
          if (!byUsername.error && byUsername.data) {
            producerRecord = byUsername.data as unknown as Record<string, unknown>;
          }
        }

        if (!producerRecord && isUuidLookup) {
          const byUserId = await supabase
            .from('public_producer_profiles')
            .select('user_id, raw_username, username, avatar_url, bio, social_links, producer_tier, xp, level, rank_tier, reputation_score, is_deleted, created_at')
            .eq('user_id', username)
            .limit(1)
            .maybeSingle();
          if (!byUserId.error && byUserId.data) {
            producerRecord = byUserId.data as unknown as Record<string, unknown>;
          }
        }

        if (!producerRecord) {
          const legacyResponse = await supabase
            .from('public_producer_profiles')
            .select('user_id, username, avatar_url, bio, social_links, producer_tier, xp, level, rank_tier, reputation_score, created_at')
            .eq('username', username)
            .limit(1)
            .maybeSingle();
          if (!legacyResponse.error && legacyResponse.data) {
            const row = legacyResponse.data as Record<string, unknown>;
            producerRecord = {
              ...row,
              raw_username: typeof row.username === 'string' ? row.username : null,
              is_deleted: false,
            };
          }
        }

        if (!producerRecord) {
          if (!isCancelled) {
            setProducer(null);
            setProfileError(t('producerProfile.notFoundTitle'));
            setIsProfileLoading(false);
          }
          return;
        }

        const producerRow = producerRecord as unknown as PublicProducerProfile;

        if (!isCancelled) {
          setProducer(producerRow);
          setIsDeletedProfile(producerRow.is_deleted === true);
        }

        if (producerRow.is_deleted === true) {
          if (!isCancelled) {
            setBeats([]);
            setBattles([]);
          }
          return;
        }

        if (!isCancelled) {
          setIsBeatsLoading(true);
          setIsBattlesLoading(true);
        }

        const [beatsResponse, battlesResponse] = await Promise.all([
          supabase
            .from('products')
            .select('id, title, slug, cover_image_url, price, bpm, key_signature, created_at')
            .eq('producer_id', producerRow.user_id)
            .eq('product_type', 'beat')
            .eq('is_published', true)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(12),
          supabase
            .from('battles')
            .select('id, title, slug, status, winner_id, producer1_id, producer2_id, created_at')
            .or(`producer1_id.eq.${producerRow.user_id},producer2_id.eq.${producerRow.user_id}`)
            .in('status', ['active', 'voting', 'completed'])
            .order('created_at', { ascending: false })
            .limit(10),
        ]);

        if (beatsResponse.error) {
          if (!isCancelled) {
            setBeats([]);
            setBeatsError(t('producerProfile.loadBeatsError'));
          }
        } else if (!isCancelled) {
          setBeats((beatsResponse.data ?? []) as PublicProducerBeat[]);
        }

        if (battlesResponse.error) {
          if (!isCancelled) {
            setBattles([]);
            setBattlesError(t('producerProfile.loadBattlesError'));
          }
        } else if (!isCancelled) {
          setBattles((battlesResponse.data ?? []) as PublicProducerBattle[]);
        }
      } catch (e) {
        console.error('Error fetching producer public page:', e);
        if (!isCancelled) {
          setProducer(null);
          setProfileError(t('producerProfile.notFoundTitle'));
        }
      } finally {
        if (!isCancelled) {
          setIsProfileLoading(false);
          setIsBeatsLoading(false);
          setIsBattlesLoading(false);
        }
      }
    };

    void fetchPublicProducer();

    return () => {
      isCancelled = true;
    };
  }, [username, t]);

  if (isProfileLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 animate-pulse">
            <div className="w-20 h-20 rounded-full bg-zinc-800 mb-4" />
            <div className="h-6 bg-zinc-800 rounded w-48 mb-3" />
            <div className="h-4 bg-zinc-800 rounded w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (profileError || !producer) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-4xl mx-auto px-4 text-center py-20">
          <h1 className="text-3xl font-bold text-white mb-3">{t('producerProfile.notFoundTitle')}</h1>
          <p className="text-zinc-400 mb-6">{profileError || t('producerProfile.unavailableProfile')}</p>
          <Link to="/producers" className="text-rose-400 hover:text-rose-300">
            {t('producerProfile.backToProducers')}
          </Link>
        </div>
      </div>
    );
  }

  if (isDeletedProfile) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-4xl mx-auto px-4 text-center py-20">
          <h1 className="text-3xl font-bold text-white mb-3">Ce compte a été supprimé</h1>
          <p className="text-zinc-400 mb-6">Ce profil a ete anonymise et n'est plus actif.</p>
          <Link to="/producers" className="text-rose-400 hover:text-rose-300">
            {t('producerProfile.backToProducers')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pt-6 pb-20">
      <div className="max-w-4xl mx-auto px-4">
        <Link to="/producers" className="inline-block text-zinc-400 hover:text-white mb-4">
          {t('producerProfile.backToProducers')}
        </Link>

        <section className="bg-gradient-to-br from-zinc-900 to-zinc-900/70 border border-zinc-800 rounded-xl p-6 md:p-8 mb-4 min-h-[240px] flex flex-col justify-center">
          <div className="flex items-center gap-5 mb-4">
            {producer.avatar_url ? (
              <img
                src={producer.avatar_url}
                alt={producer.username || t('producerProfile.unknownProducer')}
                className="w-[120px] h-[120px] rounded-full object-cover border border-zinc-700"
              />
            ) : (
              <div className="w-[120px] h-[120px] rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                <Users className="w-10 h-10 text-zinc-500" />
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold text-white">{producer.username || t('producerProfile.unknownProducer')}</h1>
              <p className="text-zinc-400">
                {t('producerProfile.activeProducer')}
                {producer.producer_tier ? ` • ${getProducerTierLabel(producer.producer_tier, t)}` : ''}
              </p>
              <ReputationBadge rankTier={producer.rank_tier} level={producer.level} xp={producer.xp} />
            </div>
          </div>
          <p className="text-zinc-300 whitespace-pre-wrap">
            {producer.bio || t('producerProfile.noBio')}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-5 max-w-xl">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t('producerProfile.statsBeats')}</p>
              <p className="text-base font-semibold text-white">{beats.length}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t('producerProfile.statsBattles')}</p>
              <p className="text-base font-semibold text-white">{battles.length}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t('producerProfile.statsWins')}</p>
              <p className="text-base font-semibold text-white">
                {battles.filter((battle) => battle.winner_id === producer.user_id).length}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t('producerProfile.statsXp')}</p>
              <p className="text-base font-semibold text-white">{producer.xp}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t('producerProfile.statsRank')}</p>
              <p className="text-base font-semibold text-white">{formatRankTier(producer.rank_tier, t)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t('producerProfile.statsLevel')}</p>
              <p className="text-base font-semibold text-white">{producer.level}</p>
            </div>
          </div>
        </section>

        {socialLinks.length > 0 && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
            <h2 className="text-lg font-semibold text-white mb-4">{t('producerProfile.socialNetworks')}</h2>
            <div className="flex flex-wrap gap-3">
              {socialLinks.map(({ key, href }) => {
                const Icon = key === 'twitter' ? Twitter : key === 'instagram' ? Instagram : Youtube;
                const label = key === 'twitter' ? 'Twitter' : key === 'instagram' ? 'Instagram' : 'YouTube';
                return (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 transition"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-500" />
                  </a>
                );
              })}
            </div>
          </section>
        )}

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">{t('producerProfile.publishedBeats')}</h2>

          {isBeatsLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, index) => (
                <div key={index} className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden animate-pulse">
                  <div className="aspect-[4/3] bg-zinc-800" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-zinc-800 rounded w-3/4" />
                    <div className="h-3 bg-zinc-800 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isBeatsLoading && beatsError && (
            <p className="text-sm text-red-400">{beatsError}</p>
          )}

          {!isBeatsLoading && !beatsError && beats.length === 0 && (
            <p className="text-sm text-zinc-400">{t('producerProfile.noPublishedBeats')}</p>
          )}

          {!isBeatsLoading && !beatsError && beats.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {beats.map((beat) => (
                <Link
                  key={beat.id}
                  to={`/beats/${beat.slug}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden transition transform-gpu hover:scale-[1.02] hover:shadow-xl hover:shadow-black/40 hover:border-zinc-600"
                >
                  {beat.cover_image_url ? (
                    <img
                      src={beat.cover_image_url}
                      alt={beat.title}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-[4/3] w-full bg-zinc-800 flex items-center justify-center">
                      <Users className="w-8 h-8 text-zinc-500" />
                    </div>
                  )}
                  <div className="p-2.5">
                    <p className="text-sm font-semibold text-white truncate">{beat.title}</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {beat.bpm ? `${beat.bpm} ${t('products.bpm')}` : '—'} · {beat.key_signature || '—'}
                    </p>
                    <p className="text-sm font-bold text-rose-300 mt-2">{formatPrice(beat.price || 0)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mt-4">
          <h2 className="text-lg font-semibold text-white mb-4">{t('producerProfile.battlesTitle')}</h2>

          {isBattlesLoading && (
            <div className="space-y-3">
              {[...Array(4)].map((_, index) => (
                <div key={index} className="h-14 rounded-lg bg-zinc-800 animate-pulse" />
              ))}
            </div>
          )}

          {!isBattlesLoading && battlesError && (
            <p className="text-sm text-red-400">{battlesError}</p>
          )}

          {!isBattlesLoading && !battlesError && battles.length === 0 && (
            <p className="text-sm text-zinc-400">{t('producerProfile.noBattles')}</p>
          )}

          {!isBattlesLoading && !battlesError && battles.length > 0 && (
            <div className="space-y-3">
              {battles.map((battle) => (
                <Link
                  key={battle.id}
                  to={`/battles/${battle.slug}`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 hover:border-zinc-600 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{battle.title}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {t('producerProfile.statusLabel')}: {battle.status}
                      </p>
                    </div>
                    {battle.winner_id === producer.user_id && (
                      <span className="shrink-0 inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                        🏆 {t('producerProfile.winnerBadge')}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
