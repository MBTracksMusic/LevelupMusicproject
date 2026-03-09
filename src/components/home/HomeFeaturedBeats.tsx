import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Headphones, ShoppingCart } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useAuth } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import { fetchPublicProducerProfilesMap } from '../../lib/supabase/publicProfiles';
import { useCartStore } from '../../lib/stores/cart';
import { formatNumber, formatPrice } from '../../lib/utils/format';

interface HomeBeatRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  play_count: number;
  cover_image_url: string | null;
  is_sold: boolean;
  producer_id: string;
  producer?: {
    id: string;
    username: string | null;
  };
}

interface HomeFeaturedBeatRpcRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  play_count: number | null;
  cover_image_url: string | null;
  is_sold: boolean | null;
  producer_id: string;
  producer_username: string | null;
}

export function HomeFeaturedBeats() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToCart } = useCartStore();
  const [beats, setBeats] = useState<HomeBeatRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addingBeatId, setAddingBeatId] = useState<string | null>(null);
  useEffect(() => {
    let isCancelled = false;

    async function fetchFeaturedBeats() {
      setIsLoading(true);

      let featuredBeats: HomeBeatRow[] = [];
      const rpcRes = await supabase.rpc('get_public_home_featured_beats' as any, { p_limit: 10 });
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        featuredBeats = (rpcRes.data as HomeFeaturedBeatRpcRow[]).map((row) => ({
          id: row.id,
          title: row.title,
          slug: row.slug,
          price: row.price,
          play_count: typeof row.play_count === 'number' ? row.play_count : 0,
          cover_image_url: row.cover_image_url,
          is_sold: row.is_sold === true,
          producer_id: row.producer_id,
          producer: {
            id: row.producer_id,
            username: row.producer_username,
          },
        }));
      }

      if (featuredBeats.length === 0) {
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
            producer_id
          `)
          .eq('product_type', 'beat')
          .eq('is_published', true)
          .is('deleted_at', null)
          .order('play_count', { ascending: false })
          .limit(10);

        if (error) {
          if (!isCancelled) {
            console.error('Error fetching featured beats for home:', error);
            if (rpcRes.error) {
              console.error('Error fetching featured beats RPC for home:', rpcRes.error);
            }
            setBeats([]);
            setIsLoading(false);
          }
          return;
        }

        const rows = ((data as HomeBeatRow[] | null) ?? []);
        const producerProfilesMap = await fetchPublicProducerProfilesMap(
          rows.map((row) => row.producer_id)
        );
        featuredBeats = rows.map((row) => {
          const producer = producerProfilesMap.get(row.producer_id);
          return {
            ...row,
            producer: producer
              ? {
                  id: producer.user_id,
                  username: producer.username,
                }
              : undefined,
          };
        });
      }

      if (!isCancelled) {
        if (rpcRes.error && featuredBeats.length > 0) {
          console.warn('Featured beats RPC failed, fallback succeeded:', rpcRes.error);
        }
        setBeats(featuredBeats);
        setIsLoading(false);
      }
    }

    void fetchFeaturedBeats();

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleAddToCart = async (beatId: string) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: location.pathname } } });
      return;
    }

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
              <h2 className="text-3xl font-bold text-white">{t('home.featuredBeats')}</h2>
            </div>
            <p className="text-zinc-400">{t('home.featuredBeatsSubtitle')}</p>
          </div>
          <Link to="/beats">
            <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
              {t('home.viewAllBeats')}
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
          <Card className="text-zinc-400">{t('home.noFeaturedBeats')}</Card>
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
                        {beat.producer?.username || t('home.unknownProducer')}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="info">
                          {formatNumber(beat.play_count)} {t('home.playsLabel')}
                        </Badge>
                        <span className="text-white font-semibold">{formatPrice(beat.price)}</span>
                      </div>
                    </div>
                  </Link>

                  {beat.is_sold ? (
                    <Badge variant="danger">{t('products.sold')}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      isLoading={addingBeatId === beat.id}
                      leftIcon={<ShoppingCart className="w-4 h-4" />}
                      variant={isAuthenticated ? 'primary' : 'outline'}
                      onClick={() => {
                        void handleAddToCart(beat.id);
                      }}
                    >
                      {isAuthenticated ? t('products.addToCart') : t('auth.loginButton')}
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
