import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase/client';
import { BattleScoreRadar, type BattleScoreRadarScores } from '../../components/battles/feedback/BattleScoreRadar';

// 5 fixtures seeded by supabase/seeds/phase1-feedback-fixtures.sql.
// Slugs documented in docs/phase1-staging-fixtures.md.
const FIXTURES = [
  {
    slug: 'phase1-fixture-1-victoire-crasante',
    label: '#1 — Victoire écrasante',
    note: '20 votes, ~80% / 20%, critère dominant (groove)',
  },
  {
    slug: 'phase1-fixture-2-match-serr',
    label: '#2 — Match serré',
    note: '20 votes, ~55% / 45%, critères dispersés',
  },
  {
    slug: 'phase1-fixture-3-data-insuffisante',
    label: '#3 — Data insuffisante',
    note: '3 votes total → coherence_data_sufficient=false',
  },
  {
    slug: 'phase1-fixture-4-galit-parfaite',
    label: '#4 — Égalité parfaite',
    note: '12 votes, 50/50, winner_id=NULL, is_tie=true',
  },
  {
    slug: 'phase1-fixture-5-battle-populaire',
    label: '#5 — Battle populaire',
    note: '60 votes → battle_size=large',
  },
] as const;

type FixturePayload = {
  battle: {
    id: string;
    slug: string;
    title: string;
    status: string;
    battle_tier: string;
    winner_product_id: string | null;
    is_tie: boolean;
  };
  snapshots: Array<{
    product_id: string;
    producer: { id: string; display_name: string; avatar_url: string | null };
    win_rate: number | string;
    scores: BattleScoreRadarScores;
    /** Per-product coherence sufficiency (≥5 feedback rows for this product). */
    coherence_data_sufficient: boolean;
    quality_index: number | string;
    rank: number;
  }>;
  meta: {
    total_voters: number;
    total_feedback: number;
    battle_size: 'small' | 'medium' | 'large';
    coherence_data_sufficient: boolean;
    credibility_dynamic: boolean;
  };
};

type FixtureState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; payload: FixturePayload };

function useFixturePayload(slug: string): FixtureState {
  const [state, setState] = useState<FixtureState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Look up the battle id by slug, then call the RPC.
      const { data: battle, error: battleErr } = await supabase
        .from('battles')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      if (cancelled) return;
      if (battleErr || !battle) {
        setState({
          status: 'error',
          message: battleErr?.message ?? `Battle "${slug}" not found. Run: psql … -f supabase/seeds/phase1-feedback-fixtures.sql`,
        });
        return;
      }

      const { data, error } = await supabase.rpc('get_battle_feedback_payload', {
        p_battle_id: battle.id,
      } as never);

      if (cancelled) return;
      if (error) {
        setState({ status: 'error', message: error.message });
        return;
      }
      setState({ status: 'ok', payload: data as unknown as FixturePayload });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return state;
}

function FixtureRow({ slug, label, note, size }: { slug: string; label: string; note: string; size: number }) {
  const state = useFixturePayload(slug);

  return (
    <section className="border-t border-zinc-800 py-8">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-zinc-100">{label}</h2>
        <p className="text-sm text-zinc-400">{note}</p>
        <p className="mt-1 text-xs text-zinc-500 font-mono">slug: {slug}</p>
      </header>

      {state.status === 'loading' && <p className="text-zinc-500 text-sm">Chargement…</p>}

      {state.status === 'error' && (
        <div className="rounded border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-300">
          <strong className="block">Fixture indisponible</strong>
          <span className="font-mono text-xs">{state.message}</span>
        </div>
      )}

      {state.status === 'ok' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {state.payload.snapshots.map((snap, idx) => (
            <div key={snap.product_id} className="flex flex-col items-center gap-3">
              <BattleScoreRadar
                scores={snap.scores}
                size={size}
                variant={idx === 0 ? 'primary' : 'secondary'}
                // Prefer per-product flag (≥5 feedbacks for this product)
                // over the global meta flag — fixes the false-negative case
                // where one producer has plenty of feedback but the other
                // is under the cutoff (coherence_score=0).
                coherenceDataSufficient={snap.coherence_data_sufficient}
                credibilityDynamic={state.payload.meta.credibility_dynamic}
                ariaLabel={`Radar ${snap.producer.display_name}`}
              />
              <div className="text-center">
                <p className="flex items-center justify-center gap-2 text-sm font-medium text-zinc-200">
                  <span>
                    {idx === 0 ? '🟧 ' : '🟥 '}
                    {snap.producer.display_name}
                  </span>
                  {state.payload.battle.is_tie && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-300">
                      = Match nul
                    </span>
                  )}
                  {!state.payload.battle.is_tie && state.payload.battle.winner_product_id === snap.product_id && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-[0_0_12px_rgba(255,106,43,0.5)]">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                        <path d="M7 3h10v2h3v3a5 5 0 0 1-5 5h-.18a5.01 5.01 0 0 1-3.82 2.91V19h3v2H8v-2h3v-3.09A5.01 5.01 0 0 1 7.18 13H7a5 5 0 0 1-5-5V5h3V3h2zm10 4V5h-2v6a3 3 0 0 0 2-2.83V7zm-10 0H5v1.17A3 3 0 0 0 7 11V5H7v2z"/>
                      </svg>
                      Gagnant
                    </span>
                  )}
                </p>
                <p className="text-xs text-zinc-500 font-mono">
                  art:{snap.scores.artistic} · coh:{snap.scores.coherence} · cred:{snap.scores.credibility} · pref:{snap.scores.preference}
                </p>
                <p className="text-xs text-zinc-600 font-mono">
                  win_rate:{snap.win_rate} · quality_index:{snap.quality_index}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function RadarPreviewPage() {
  // Dev-only guard. In production builds, redirect away.
  if (!import.meta.env.DEV) {
    return <Navigate to="/" replace />;
  }

  const [size, setSize] = useState<number>(240);

  const sizes = useMemo(() => [200, 240, 320], []);

  return (
    <div className="min-h-screen bg-[var(--brand-bg)] text-zinc-100 px-4 py-6 md:px-12">
      <div className="sticky top-0 z-10 -mx-4 md:-mx-12 px-4 md:px-12 py-3 mb-4 bg-zinc-950/80 backdrop-blur border-b border-zinc-800 flex items-center gap-4">
        <h1 className="text-xl font-bold">Radar Preview Lab — Phase 1 fixtures</h1>
        <span className="text-xs text-zinc-500 font-mono">dev only</span>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-zinc-400">size:</span>
          {sizes.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`px-2 py-1 rounded text-xs border transition ${
                size === s
                  ? 'bg-brand-primary/20 border-brand-primary text-brand-primary'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {s}px
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-zinc-400 mb-2">
        Fetched live from staging via <code className="text-xs">get_battle_feedback_payload</code>.
        Hover labels on coherence/credibility axes for tooltips.
      </p>

      {FIXTURES.map((f) => (
        <FixtureRow key={f.slug} slug={f.slug} label={f.label} note={f.note} size={size} />
      ))}

      <p className="mt-12 text-xs text-zinc-600">
        Validation checklist:
        <br />□ #1 dominant : polygone primary nettement plus grand
        <br />□ #4 tie : les 2 polygones identiques en taille + label "égalité"
        <br />□ #3 insufficient : axe coherence à 0 avec dot ambre + tooltip
        <br />□ #1 producer2 : axe coherence à 0 avec dot ambre (cutoff per-product)
        <br />□ tous : axe credibility à 50 plat avec dot gris + tooltip
        <br />□ couleurs primary (orange) vs secondary (rouge) distinctes
        <br />□ dark mode lisible
        <br />□ 200px reste lisible (mobile-like)
        <br />□ 320px reste élégant (desktop-like)
      </p>
    </div>
  );
}
