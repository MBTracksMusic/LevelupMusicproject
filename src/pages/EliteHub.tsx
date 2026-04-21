import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProductCard } from '../components/products/ProductCard';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { Track } from '../context/AudioPlayerContext';
import { hasPlayableTrackSource, toTrack } from '../lib/audio/track';
import { fetchEliteProducts } from '../lib/supabase/elite';
import type { ProductWithRelations } from '../lib/supabase/types';

export function EliteHubPage() {
  const [products, setProducts] = useState<ProductWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadProducts = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const nextProducts = await fetchEliteProducts();
        if (!isCancelled) {
          setProducts(nextProducts);
        }
      } catch (loadError) {
        console.error('elite hub load error', loadError);
        if (!isCancelled) {
          setProducts([]);
          setError('Unable to load elite beats right now.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadProducts();

    return () => {
      isCancelled = true;
    };
  }, []);

  const playbackQueue = useMemo<Track[]>(
    () =>
      products
        .filter((product) =>
          hasPlayableTrackSource({
            preview_url: product.preview_url,
            watermarked_path: product.watermarked_path,
            exclusive_preview_url: product.exclusive_preview_url,
            watermarked_bucket: product.watermarked_bucket,
          }),
        )
        .map((product) =>
          toTrack({
            id: product.id,
            title: product.title,
            audioUrl: product.preview_url,
            cover_image_url: product.cover_image_url,
            producerId: product.producer_id,
            preview_url: product.preview_url,
            watermarked_path: product.watermarked_path,
            exclusive_preview_url: product.exclusive_preview_url,
            watermarked_bucket: product.watermarked_bucket,
          }),
        )
        .filter((track): track is Track => track !== null),
    [products],
  );

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-amber-300">Private ecosystem</p>
          <h1 className="text-3xl font-bold text-white">Elite Hub</h1>
          <p className="text-zinc-400 max-w-2xl">
            Private access for elite producers and verified labels. Only beats flagged as elite are listed here.
          </p>
        </div>

        {error && (
          <Card className="p-5 border border-red-500/30 bg-red-500/10 text-red-200">
            {error}
          </Card>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-[380px] rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <Card className="p-8 text-center space-y-4">
            <h2 className="text-xl font-semibold text-white">No elite beats yet</h2>
            <p className="text-zinc-400">
              An admin must flag beats as elite before they appear in this private catalog.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link to="/beats">
                <Button variant="outline">Back to marketplace</Button>
              </Link>
              <Link to="/label-access">
                <Button variant="secondary">Manage label access</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                playbackQueue={playbackQueue}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default EliteHubPage;
