import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import type { UserProfile } from '../lib/supabase/types';

export function ProducerPublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [producer, setProducer] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const fetchProducer = async () => {
      if (!username) {
        setError('Nom utilisateur manquant.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('username', username)
          .eq('is_producer_active', true)
          .single();

        if (fetchError || !data) {
          if (!isCancelled) {
            setProducer(null);
            setError('Producteur introuvable');
          }
          return;
        }

        if (!isCancelled) {
          setProducer(data as UserProfile);
        }
      } catch (e) {
        console.error('Error fetching producer public profile:', e);
        if (!isCancelled) {
          setProducer(null);
          setError('Producteur introuvable');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchProducer();

    return () => {
      isCancelled = true;
    };
  }, [username]);

  if (isLoading) {
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

  if (error || !producer) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-4xl mx-auto px-4 text-center py-20">
          <h1 className="text-3xl font-bold text-white mb-3">Producteur introuvable</h1>
          <p className="text-zinc-400 mb-6">{error || 'Ce profil est indisponible.'}</p>
          <Link to="/producers" className="text-rose-400 hover:text-rose-300">
            Retour aux producteurs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4">
        <Link to="/producers" className="inline-block text-zinc-400 hover:text-white mb-6">
          Retour aux producteurs
        </Link>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
          <div className="flex items-center gap-4 mb-4">
            {producer.avatar_url ? (
              <img
                src={producer.avatar_url}
                alt={producer.username || 'Producteur'}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center">
                <Users className="w-8 h-8 text-zinc-500" />
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold text-white">{producer.username || 'Producteur'}</h1>
              <p className="text-zinc-400">Producteur actif</p>
            </div>
          </div>
          <p className="text-zinc-300 whitespace-pre-wrap">
            {producer.bio || 'Aucune biographie disponible.'}
          </p>
        </div>
      </div>
    </div>
  );
}
