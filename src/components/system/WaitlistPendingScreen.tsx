import { supabase } from '@/lib/supabase/client';
import type { LaunchMessages } from '@/lib/supabase/useLaunchAccess';
import toast from 'react-hot-toast';

interface WaitlistPendingScreenProps {
  messages: LaunchMessages;
}

export function WaitlistPendingScreen({ messages }: WaitlistPendingScreenProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success('Déconnecté.');
  };

  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[400px] w-[400px] rounded-full bg-amber-500/8 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">

        {/* Status badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
            En attente
          </span>
        </div>

        {/* Main message */}
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {messages.headline}
        </h1>
        <p className="mt-4 max-w-sm text-base text-zinc-400">
          {messages.subline}
        </p>

        {/* Visual divider */}
        <div className="mt-10 w-16 border-t border-zinc-800" />

        {/* Info card */}
        <div className="mt-8 w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-left space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-base">🔒</span>
            <p className="text-sm text-zinc-400">
              L&apos;accès est ouvert progressivement à mesure que la plateforme monte en charge.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-base">📩</span>
            <p className="text-sm text-zinc-400">
              Tu recevras un email dès que ton accès est activé. Vérifie aussi tes spams.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-base">🎧</span>
            <p className="text-sm text-zinc-400">
              Beatelion — beats, battles et communauté réservés aux producteurs sérieux.
            </p>
          </div>
        </div>

        {/* Sign out option */}
        <p className="mt-8 text-sm text-zinc-600">
          Mauvais compte ?{' '}
          <button
            type="button"
            onClick={handleSignOut}
            className="text-zinc-400 underline underline-offset-2 hover:text-white transition-colors"
          >
            Se déconnecter
          </button>
        </p>

        {/* Footer */}
        <p className="mt-12 text-xs text-zinc-700">
          © {new Date().getFullYear()} Beatelion
        </p>
      </div>
    </div>
  );
}
