import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

interface ProducerListItem {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_producer_active: boolean;
}

export function ProducersPage() {
  const [producers, setProducers] = useState<ProducerListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const fetchProducers = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('id, username, avatar_url, bio, is_producer_active')
          .eq('is_producer_active', true)
          .order('updated_at', { ascending: false });

        if (error) throw error;

        if (!isCancelled) {
          setProducers((data ?? []) as ProducerListItem[]);
        }
      } catch (error) {
        console.error('Error fetching producers:', error);
        if (!isCancelled) {
          setProducers([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchProducers();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Producteurs actifs</h1>
          <p className="text-zinc-400">Decouvrez les producteurs actuellement abonnes.</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 animate-pulse">
                <div className="w-16 h-16 rounded-full bg-zinc-800 mb-4" />
                <div className="h-4 bg-zinc-800 rounded w-2/3 mb-3" />
                <div className="h-3 bg-zinc-800 rounded w-full" />
              </div>
            ))}
          </div>
        ) : producers.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-400">Aucun producteur actif pour le moment.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {producers.map((producer) => {
              const cardContent = (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center gap-4 mb-4">
                    {producer.avatar_url ? (
                      <img
                        src={producer.avatar_url}
                        alt={producer.username || 'Producteur'}
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
                        <Users className="w-6 h-6 text-zinc-500" />
                      </div>
                    )}
                    <h2 className="text-lg font-semibold text-white truncate">
                      {producer.username || 'Producteur'}
                    </h2>
                  </div>
                  <p className="text-sm text-zinc-400 line-clamp-3">
                    {producer.bio || 'Aucune biographie disponible.'}
                  </p>
                </div>
              );

              if (!producer.username) {
                return <div key={producer.id}>{cardContent}</div>;
              }

              return (
                <Link key={producer.id} to={`/producers/${producer.username}`}>
                  {cardContent}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
