import { Building2, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { canAccessEliteHub, canRequestLabelAccess, isEliteProducer, isVerifiedLabel } from '../../lib/auth/elite';
import type { UserProfile } from '../../lib/supabase/types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface PrivateAccessCardProps {
  profile: UserProfile | null | undefined;
  className?: string;
}

export function PrivateAccessCard({ profile, className = '' }: PrivateAccessCardProps) {
  if (!profile) return null;

  const hasEliteAccess = canAccessEliteHub(profile);
  const canRequestAccess = canRequestLabelAccess(profile);

  if (!hasEliteAccess && !canRequestAccess) {
    return null;
  }

  const isLabelAccount = isVerifiedLabel(profile);
  const isEliteAccount = isEliteProducer(profile);
  const title = hasEliteAccess
    ? isLabelAccount
      ? 'Acces label valide'
      : 'Acces elite disponible'
    : 'Acces label prive';
  const description = hasEliteAccess
    ? isLabelAccount
      ? 'Votre compte label verifie peut acceder aux titres prives depuis Elite Hub.'
      : isEliteAccount
        ? 'Votre compte elite producer peut acceder aux titres prives depuis Elite Hub.'
        : 'Votre compte a acces au catalogue prive.'
    : 'Si vous representez une maison de disque, vous pouvez demander un acces prive. La validation est faite par l\'admin.';
  const ctaHref = hasEliteAccess ? '/elite-hub' : '/label-access';
  const ctaLabel = hasEliteAccess ? 'Ouvrir Elite Hub' : 'Demander un acces label';
  const Icon = hasEliteAccess ? ShieldCheck : Building2;

  return (
    <Card className={`p-6 border ${hasEliteAccess ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-cyan-500/30 bg-cyan-500/10'} ${className}`.trim()}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-xl p-2 ${hasEliteAccess ? 'bg-emerald-500/15 text-emerald-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-zinc-300">{description}</p>
          </div>
        </div>
        <Link to={ctaHref}>
          <Button variant={hasEliteAccess ? 'secondary' : 'outline'}>
            {ctaLabel}
          </Button>
        </Link>
      </div>
    </Card>
  );
}
