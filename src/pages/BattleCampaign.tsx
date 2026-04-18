import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LogoLoader } from '../components/ui/LogoLoader';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime } from '../lib/utils/format';

interface CampaignRow {
  id: string;
  title: string;
  description: string | null;
  social_description: string | null;
  cover_image_url: string | null;
  share_slug: string;
  status: 'applications_open' | 'selection_locked' | 'launched' | 'cancelled';
  participation_deadline: string;
  submission_deadline: string;
  battle_id: string | null;
}

export function BattleCampaignPage() {
  const { slug } = useParams<{ slug: string }>();
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [battleSlug, setBattleSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined' || !slug) return '';
    return `${window.location.origin}/battle-campaign/${slug}`;
  }, [slug]);

  useEffect(() => {
    let isCancelled = false;

    async function loadCampaign() {
      if (!slug) {
        setError('Campaign not found.');
        setCampaign(null);
        setIsLoading(false);
        return;
      }

      setError(null);
      setIsLoading(true);

      const { data, error: campaignError } = await supabase
        .from('admin_battle_campaigns_public' as any)
        .select(`
          id,
          title,
          description,
          social_description,
          cover_image_url,
          share_slug,
          status,
          participation_deadline,
          submission_deadline,
          battle_id
        `)
        .eq('share_slug', slug)
        .maybeSingle();

      if (isCancelled) return;

      if (campaignError) {
        console.error('Error loading battle campaign:', campaignError);
        setError(campaignError.message);
        setCampaign(null);
        setBattleSlug(null);
        setIsLoading(false);
        return;
      }

      const row = (data as CampaignRow | null) ?? null;
      if (!row) {
        setError('Cette campagne n’est plus disponible.');
        setCampaign(null);
        setBattleSlug(null);
        setIsLoading(false);
        return;
      }

      setCampaign(row);

      if (row.battle_id) {
        const { data: battleData, error: battleError } = await supabase
          .from('battles')
          .select('slug')
          .eq('id', row.battle_id)
          .maybeSingle();

        if (battleError) {
          console.error('Error loading launched battle slug for campaign page:', battleError);
          setBattleSlug(null);
        } else {
          setBattleSlug((battleData as { slug: string } | null)?.slug ?? null);
        }
      } else {
        setBattleSlug(null);
      }

      setIsLoading(false);
    }

    void loadCampaign();

    return () => {
      isCancelled = true;
    };
  }, [slug]);

  const shareText = '🔥 New Beat Battle on LevelUp\nJoin the challenge and compete with the best producers.';

  const openTwitterShare = () => {
    if (!shareUrl) return;
    const text = encodeURIComponent(shareText);
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener,noreferrer');
  };

  const openFacebookShare = () => {
    if (!shareUrl) return;
    const url = encodeURIComponent(shareUrl);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener,noreferrer');
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch (copyError) {
      console.error('Unable to copy campaign link:', copyError);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LogoLoader label="Loading campaign..." />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-10 pb-20">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="space-y-3">
            <h1 className="text-2xl font-bold text-white">Campagne introuvable</h1>
            <p className="text-zinc-400">{error || 'La campagne demandée n’est plus disponible.'}</p>
            <Link to="/battles">
              <Button variant="outline">Back to battles</Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pt-10 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <Card className="overflow-hidden p-0">
          {campaign.cover_image_url ? (
            <img
              src={campaign.cover_image_url}
              alt={campaign.title}
              className="w-full h-64 object-cover"
            />
          ) : (
            <div className="h-64 bg-zinc-900 flex items-center justify-center text-zinc-500 text-sm">
              No campaign image
            </div>
          )}
          <div className="p-6 space-y-4">
            <h1 className="text-3xl font-bold text-white">{campaign.title}</h1>
            {campaign.description && <p className="text-zinc-200">{campaign.description}</p>}
            {campaign.social_description && <p className="text-zinc-400 text-sm">{campaign.social_description}</p>}
            <p className="text-zinc-500 text-sm">
              Participation deadline: {formatDateTime(campaign.participation_deadline)}
              <br />
              Submission deadline: {formatDateTime(campaign.submission_deadline)}
            </p>

            {battleSlug && (
              <Link to={`/battles/${battleSlug}`}>
                <Button>Open battle</Button>
              </Link>
            )}
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Share this official battle</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={openTwitterShare}>Twitter / X</Button>
            <Button variant="outline" size="sm" onClick={openFacebookShare}>Facebook</Button>
            <Button variant="outline" size="sm" onClick={() => void copyShareLink()}>Instagram (copy link)</Button>
            <Button variant="outline" size="sm" onClick={() => void copyShareLink()}>Copy Link</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
