import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Headphones, ShoppingCart } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useAuth } from '../../lib/auth/hooks';
import { supabase } from '../../lib/supabase/client';
import { useCartStore } from '../../lib/stores/cart';
import { formatPrice } from '../../lib/utils/format';

interface HomeBeatRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  play_count: number;
  cover_image_url: string | null;
  is_sold: boolean;
  producer?: {
    id: string;
    username: string | null;
  };
}

const numberFormatter = new Intl.NumberFormat('fr-FR');

export function HomeFeaturedBeats() {
  const { isAuthenticated } = useAuth();
  const { addToCart } = useCartStore();
  const [beats, setBeats] = useState<HomeBeatRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addingBeatId, setAddingBeatId] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchFeaturedBeats() {
      setIsLoading(true);

      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          title,
          slug,
          price,
          play_count,
          cover_image_url,
          is_sold,
          producer:user_profiles!products_producer_id_fkey(id, username)
        `)
        .eq('product_type', 'beat')
        .eq('is_published', true)
        .is('deleted_at', null)
        .order('play_count', { ascending: false })
        .limit(10);

      if (!isCancelled) {
        if (error) {
          console.error('Error fetching featured beats for home:', error);
          setBeats([]);
        } else {
          setBeats((data as HomeBeatRow[] | null) ?? []);
        }
        setIsLoading(false);
      }
    }

    void fetchFeaturedBeats();

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleAddToCart = async (beatId: string) => {
    if (!isAuthenticated) return;

    setAddingBeatId(beatId);
    try {
      await addToCart(beatId);
    } catch (error) {
      console.error('Error adding featured beat to cart:', error);
    } finally {
      setAddingBeatId(null);
    }
  };

  return (
    <section className="py-20 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Headphones className="w-5 h-5 text-emerald-400" />
              <h2 className="text-3xl font-bold text-white">Beats en vedette</h2>
            </div>
            <p className="text-zinc-400">Top 10 des beats les plus ecoutes</p>
          </div>
          <Link to="/beats">
            <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
              Voir tous les beats
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 animate-pulse space-y-3">
                <div className="h-4 bg-zinc-800 rounded w-1/2" />
                <div className="h-3 bg-zinc-800 rounded w-1/3" />
                <div className="h-8 bg-zinc-800 rounded w-32" />
              </div>
            ))}
          </div>
        ) : beats.length === 0 ? (
          <Card className="text-zinc-400">Aucun beat public a afficher pour le moment.</Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {beats.map((beat) => (
              <Card key={beat.id} className="p-4">
                <div className="flex items-center gap-4">
                  <Link to={`/beats/${beat.slug}`} className="flex items-center gap-4 min-w-0 flex-1">
                    {beat.cover_image_url ? (
                      <img
                        src={beat.cover_image_url}
                        alt={beat.title}
                        className="w-14 h-14 rounded-lg object-cover border border-zinc-800"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-zinc-800 border border-zinc-700" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-white font-semibold truncate">{beat.title}</p>
                      <p className="text-zinc-400 text-sm truncate">
                        {beat.producer?.username || 'Producteur inconnu'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="info">
                          {numberFormatter.format(beat.play_count)} lectures
                        </Badge>
                        <span className="text-white font-semibold">{formatPrice(beat.price)}</span>
                      </div>
                    </div>
                  </Link>

                  {beat.is_sold ? (
                    <Badge variant="danger">Vendu</Badge>
                  ) : (
                    <Button
                      size="sm"
                      isLoading={addingBeatId === beat.id}
                      disabled={!isAuthenticated}
                      leftIcon={<ShoppingCart className="w-4 h-4" />}
                      onClick={() => {
                        void handleAddToCart(beat.id);
                      }}
                    >
                      {isAuthenticated ? 'Ajouter' : 'Connexion requise'}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
