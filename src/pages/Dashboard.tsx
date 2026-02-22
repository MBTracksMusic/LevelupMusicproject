import { useEffect, useMemo, useState } from 'react';
import { User, Mail, Shield, Music, ShoppingBag, Heart, Download, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';
import type { License, ProductWithRelations, Purchase } from '../lib/supabase/types';
import { buildAudioStoragePathCandidates, extractStoragePathFromCandidate } from '../lib/utils/storage';
import { formatPrice } from '../lib/utils/format';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ProductCard } from '../components/products/ProductCard';
import { useWishlistStore } from '../lib/stores/wishlist';

interface DashboardPurchase extends Purchase {
  product: ProductWithRelations | null;
  license: License | null;
}

interface WishlistProductRow {
  product: ProductWithRelations | null;
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getDeclaredContractPathCandidates = (purchase: DashboardPurchase) => {
  const metadata = purchase.metadata as Record<string, unknown> | null;
  const metadataCandidates = [
    metadata?.contract_pdf_path,
    metadata?.contract_path,
    metadata?.contract_pdf,
    metadata?.pdf_path,
  ]
    .map(asNonEmptyString)
    .filter(Boolean) as string[];

  return [
    asNonEmptyString(purchase.contract_pdf_path),
    ...metadataCandidates,
  ].filter(Boolean) as string[];
};

const getContractPathCandidates = (purchase: DashboardPurchase) => {
  const declared = getDeclaredContractPathCandidates(purchase);
  return [...new Set([...declared, `contracts/${purchase.id}.pdf`, `${purchase.id}.pdf`])];
};

const toNullableNumber = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const toNullableBoolean = (value: unknown) => {
  if (typeof value !== 'boolean') return null;
  return value;
};

const formatLimit = (value: number | null) =>
  value === null ? 'Illimité' : value.toLocaleString('fr-FR');

const formatBoolean = (value: boolean | null) => {
  if (value === null) return 'Non défini';
  return value ? 'Oui' : 'Non';
};

const roleLabels: Record<string, string> = {
  visitor: 'Visiteur',
  user: 'Utilisateur',
  confirmed_user: 'Utilisateur confirme',
  producer: 'Producteur',
  admin: 'Administrateur',
};

const roleColors: Record<string, string> = {
  visitor: 'bg-zinc-700',
  user: 'bg-blue-600',
  confirmed_user: 'bg-green-600',
  producer: 'bg-orange-600',
  admin: 'bg-rose-600',
};

const AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'beats-audio';

export function DashboardPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { fetchWishlist, toggleWishlist } = useWishlistStore();
  const [purchases, setPurchases] = useState<DashboardPurchase[]>([]);
  const [awaitingAdminCount, setAwaitingAdminCount] = useState<number>(0);
  const [wishlistCount, setWishlistCount] = useState<number>(0);
  const [recentWishlist, setRecentWishlist] = useState<ProductWithRelations[]>([]);
  const [isWishlistLoading, setIsWishlistLoading] = useState(false);
  const [selectedLicensePurchase, setSelectedLicensePurchase] = useState<DashboardPurchase | null>(null);
  const [isPurchasesLoading, setIsPurchasesLoading] = useState(true);
  const [purchasesError, setPurchasesError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadPurchases = async () => {
      if (!user?.id) {
        if (!isCancelled) {
          setPurchases([]);
          setIsPurchasesLoading(false);
        }
        return;
      }

      setIsPurchasesLoading(true);
      setPurchasesError(null);

      try {
        const { data, error } = await supabase
          .from('purchases')
          .select(`
            *,
            product:products!purchases_product_id_fkey(
              *,
              producer:user_profiles!products_producer_id_fkey(id, username, avatar_url)
            ),
            license:licenses!purchases_license_id_fkey(
              id,
              name,
              description,
              max_streams,
              max_sales,
              youtube_monetization,
              music_video_allowed,
              credit_required,
              exclusive_allowed,
              price,
              created_at,
              updated_at
            )
          `)
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) {
          throw error;
        }

        if (!isCancelled) {
          setPurchases((data as DashboardPurchase[]) || []);
        }
      } catch (error) {
        console.error('Error loading purchases:', error);
        if (!isCancelled) {
          setPurchasesError("Impossible de charger vos achats pour l'instant.");
        }
      } finally {
        if (!isCancelled) {
          setIsPurchasesLoading(false);
        }
      }
    };

    void loadPurchases();

    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let isCancelled = false;

    const loadWishlistData = async () => {
      if (!user?.id) {
        if (!isCancelled) {
          setWishlistCount(0);
          setRecentWishlist([]);
          setIsWishlistLoading(false);
        }
        return;
      }

      setIsWishlistLoading(true);

      try {
        const [{ count, error: countError }, { data, error: recentError }] = await Promise.all([
          supabase
            .from('wishlists')
            .select('product_id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabase
            .from('wishlists')
            .select(`
              product:products(
                *,
                producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
                genre:genres(*),
                mood:moods(*)
              )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(3),
        ]);

        if (countError) {
          console.error('Error loading wishlist count:', countError);
        } else if (!isCancelled) {
          setWishlistCount(count ?? 0);
        }

        if (recentError) {
          console.error('Error loading recent wishlist products:', recentError);
          if (!isCancelled) {
            setRecentWishlist([]);
          }
        } else if (!isCancelled) {
          const rows = (data as WishlistProductRow[] | null) ?? [];
          const mappedProducts = rows
            .map((row) => row.product)
            .filter((product): product is ProductWithRelations => product !== null);
          setRecentWishlist(mappedProducts);
        }

        await fetchWishlist();
      } catch (error) {
        console.error('Error loading wishlist data:', error);
      } finally {
        if (!isCancelled) {
          setIsWishlistLoading(false);
        }
      }
    };

    void loadWishlistData();

    return () => {
      isCancelled = true;
    };
  }, [user?.id, fetchWishlist]);

  useEffect(() => {
    let isCancelled = false;

    const loadAwaitingAdminCount = async () => {
      if (!user?.id || profile?.role !== 'admin') {
        if (!isCancelled) {
          setAwaitingAdminCount(0);
        }
        return;
      }

      const { count, error } = await supabase
        .from('battles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'awaiting_admin');

      if (error) {
        console.error('Error loading awaiting_admin battle count:', error);
        if (!isCancelled) {
          setAwaitingAdminCount(0);
        }
        return;
      }

      if (!isCancelled) {
        setAwaitingAdminCount(count ?? 0);
      }
    };

    void loadAwaitingAdminCount();

    return () => {
      isCancelled = true;
    };
  }, [profile?.role, user?.id]);

  const purchaseCount = purchases.length;

  const stats = useMemo(
    () => [
      {
        label: 'Achats',
        value: purchaseCount,
        icon: ShoppingBag,
        color: 'text-blue-400',
      },
      {
        label: 'Favoris',
        value: wishlistCount,
        icon: Heart,
        color: 'text-rose-400',
        onClick: () => navigate('/wishlist'),
      },
      ...(profile?.role === 'admin'
        ? [{
            label: 'Battles en attente',
            value: awaitingAdminCount,
            icon: Shield,
            color: 'text-amber-400',
            onClick: () => navigate('/admin/battles'),
          }]
        : []),
      ...(profile?.is_producer_active
        ? [{
            label: 'Statut producteur',
            value: 'Actif',
            icon: Music,
            color: 'text-orange-400',
          }]
        : []),
    ],
    [awaitingAdminCount, purchaseCount, wishlistCount, navigate, profile?.is_producer_active, profile?.role]
  );

  const handleRecentWishlistToggle = async (productId: string) => {
    if (!user?.id) return;

    try {
      await toggleWishlist(productId);
      setRecentWishlist((prev) => prev.filter((product) => product.id !== productId));
      setWishlistCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error toggling wishlist item from dashboard:', error);
    }
  };

  const getPurchaseFilePath = (purchase: DashboardPurchase) => {
    const metadata = purchase.metadata as Record<string, unknown> | null;
    const metadataPathCandidates = [
      metadata?.file_path,
      metadata?.track_path,
      metadata?.storage_path,
      metadata?.download_path,
      metadata?.master_url,
    ];

    for (const candidate of metadataPathCandidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate;
      }
    }

    return (
      purchase.product?.master_url ||
      purchase.product?.preview_url ||
      purchase.product?.exclusive_preview_url ||
      null
    );
  };

  const handleDownload = async (rawPath: string) => {
    const filePath = rawPath.trim();
    if (!filePath) return;

    const forceFileDownload = async (url: string, fallbackName = 'track.mp3') => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    };

    if (filePath.startsWith('http')) {
      const fallbackName = decodeURIComponent(
        filePath.split('?')[0].split('/').pop() || 'track.mp3'
      );
      try {
        await forceFileDownload(filePath, fallbackName);
        toast.success('Téléchargement lancé');
      } catch (error) {
        console.error('Download error:', error);
        toast.error('Téléchargement impossible pour le moment.');
      }
      return;
    }

    const resolvedPath =
      extractStoragePathFromCandidate(filePath, AUDIO_BUCKET) || filePath;
    const fallbackName = decodeURIComponent(
      resolvedPath.split('/').pop() || 'track.mp3'
    );

    const pathCandidates = buildAudioStoragePathCandidates(resolvedPath);
    let lastError: unknown = null;

    for (const pathToSign of pathCandidates) {
      const { data, error } = await supabase.storage
        .from(AUDIO_BUCKET)
        .createSignedUrl(pathToSign, 60, { download: fallbackName });

      if (data?.signedUrl) {
        try {
          await forceFileDownload(data.signedUrl, fallbackName);
          toast.success('Téléchargement lancé');
        } catch (downloadError) {
          console.error('Download error:', downloadError);
          toast.error('Téléchargement impossible pour le moment.');
        }
        return;
      }

      lastError = error;
    }

    console.error('Download error:', lastError);
    toast.error('Téléchargement impossible pour le moment.');
  };

  const handleLicenseDownload = async (purchase: DashboardPurchase) => {
    const { data: contractData, error: contractError } = await supabase.functions.invoke<{
      url: string;
      expires_in: number;
      path?: string;
    }>('get-contract-url', {
      body: { purchase_id: purchase.id },
    });

    if (!contractError && contractData?.url) {
      window.open(contractData.url, '_blank');
      return;
    }

    const pathCandidates = getContractPathCandidates(purchase);
    const normalizedCandidates = [...new Set(pathCandidates.map((path) => path.trim()).filter(Boolean))];
    let lastError: unknown = null;

    if (normalizedCandidates.length > 0) {
      for (const candidate of normalizedCandidates) {
        if (candidate.startsWith('http')) {
          window.open(candidate, '_blank');
          return;
        }

        const normalizedPath =
          extractStoragePathFromCandidate(candidate, 'contracts') || candidate;

        const { data, error } = await supabase.storage
          .from('contracts')
          .createSignedUrl(normalizedPath, 60, { download: true });

        if (data?.signedUrl && !error) {
          window.open(data.signedUrl, '_blank');
          return;
        }

        lastError = error;
      }
    }

    console.warn('Contract PDF unavailable', {
      purchaseId: purchase.id,
      triedCandidates: normalizedCandidates,
      functionError: contractError,
      lastError,
    });
    toast.error('Téléchargement du contrat impossible pour le moment (PDF indisponible).');
  };

  const selectedLicenseMetadata = (selectedLicensePurchase?.metadata as Record<string, unknown> | null) || null;
  const selectedLicense = selectedLicensePurchase?.license || null;
  const selectedLicenseName =
    selectedLicense?.name || selectedLicensePurchase?.license_type || 'Licence';
  const selectedLicenseDescription =
    selectedLicense?.description ||
    (typeof selectedLicenseMetadata?.license_description === 'string'
      ? selectedLicenseMetadata.license_description
      : 'Description indisponible pour cet achat.');

  const selectedMaxStreams =
    selectedLicense?.max_streams ??
    toNullableNumber(selectedLicenseMetadata?.max_streams);

  const selectedMaxSales =
    selectedLicense?.max_sales ??
    toNullableNumber(selectedLicenseMetadata?.max_sales);

  const selectedYoutubeMonetization =
    selectedLicense?.youtube_monetization ??
    toNullableBoolean(selectedLicenseMetadata?.youtube_monetization);

  const selectedMusicVideoAllowed =
    selectedLicense?.music_video_allowed ??
    toNullableBoolean(selectedLicenseMetadata?.music_video_allowed);

  const selectedCreditRequired =
    selectedLicense?.credit_required ??
    toNullableBoolean(selectedLicenseMetadata?.credit_required);

  const selectedExclusiveAllowed =
    selectedLicense?.exclusive_allowed ??
    toNullableBoolean(selectedLicenseMetadata?.exclusive_allowed);

  return (
    <div className="pt-20 pb-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Tableau de bord</h1>
          <p className="text-zinc-400">Bienvenue, {profile?.username || user?.email}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className="p-6"
              variant={stat.onClick ? 'interactive' : 'default'}
              onClick={stat.onClick}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-400 mb-1">{stat.label}</p>
                  <p className="text-3xl font-bold text-white">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-xl bg-zinc-800 ${stat.color}`}>
                  <stat.icon className="w-6 h-6" />
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-rose-400" />
              Informations du profil
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">Nom d'utilisateur</span>
                <span className="text-white font-medium">{profile?.username || '-'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">Email</span>
                <span className="text-white font-medium">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">Role</span>
                <Badge className={roleColors[profile?.role || 'visitor']}>
                  {roleLabels[profile?.role || 'visitor']}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-zinc-400">Producteur actif</span>
                <Badge className={profile?.is_producer_active ? 'bg-green-600' : 'bg-zinc-700'}>
                  {profile?.is_producer_active ? 'Oui' : 'Non'}
                </Badge>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-rose-400" />
              Securite du compte
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">Email verifie</span>
                <Badge className={user?.email_confirmed_at ? 'bg-green-600' : 'bg-orange-600'}>
                  {user?.email_confirmed_at ? 'Oui' : 'En attente'}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">Inscription</span>
                <span className="text-white">
                  {user?.created_at
                    ? new Date(user.created_at).toLocaleDateString('fr-FR')
                    : '-'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-zinc-400">Derniere connexion</span>
                <span className="text-white">
                  {user?.last_sign_in_at
                    ? new Date(user.last_sign_in_at).toLocaleDateString('fr-FR')
                    : '-'}
                </span>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-6 mt-6" id="purchases">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-rose-400" />
              Mes achats
            </h2>
            <Badge className="bg-zinc-700">{purchases.length}</Badge>
          </div>

          {isPurchasesLoading && (
            <div className="py-6 text-zinc-500">Chargement de vos achats...</div>
          )}

          {!isPurchasesLoading && purchasesError && (
            <div className="py-6 text-rose-300">{purchasesError}</div>
          )}

          {!isPurchasesLoading && !purchasesError && purchases.length === 0 && (
            <div className="py-6 text-zinc-500">Aucun achat valide pour le moment.</div>
          )}

          {!isPurchasesLoading && !purchasesError && purchases.length > 0 && (
            <ul className="divide-y divide-zinc-800">
              {purchases.map((purchase) => {
                const product = purchase.product;
                const license = purchase.license;
                const track = { id: getPurchaseFilePath(purchase) };
                const canDownload = Boolean(track.id);
                const licenseName = license?.name || purchase.license_type || 'Licence';
                const licenseDescription =
                  license?.description ||
                  "Les droits détaillés de cette licence sont disponibles dans le contrat.";
                const canViewLicenseDetails = Boolean(license || purchase.license_type);

                return (
                  <li
                    key={purchase.id}
                    className="py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {product?.cover_image_url ? (
                        <img
                          src={product.cover_image_url}
                          alt={product.title}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-xs text-zinc-500">
                          MP3
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-white font-medium truncate">
                          {product?.title || 'Titre indisponible'}
                        </p>
                        <p className="text-sm text-zinc-400 truncate">
                          {product?.producer?.username || 'Producteur'} ·{' '}
                          {new Date(purchase.created_at).toLocaleDateString('fr-FR')}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                            {licenseName}
                          </span>
                          <span>{purchase.is_exclusive ? 'Exclusif' : 'Standard'}</span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                          {licenseDescription}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2">
                      {canDownload && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!track.id) return;
                            void handleDownload(track.id);
                          }}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Télécharger audio
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          void handleLicenseDownload(purchase);
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Télécharger licence
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLicensePurchase(purchase)}
                        disabled={!canViewLicenseDetails}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FileText className="w-4 h-4" />
                        Voir détails de licence
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-6 mt-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-400" />
              Mes favoris récents
            </h2>
            <Badge className="bg-zinc-700">{wishlistCount}</Badge>
          </div>

          {isWishlistLoading && recentWishlist.length === 0 && (
            <div className="py-6 text-zinc-500">Chargement de vos favoris...</div>
          )}

          {!isWishlistLoading && recentWishlist.length === 0 && (
            <div className="py-6 text-zinc-500">Aucun favori pour le moment</div>
          )}

          {recentWishlist.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {recentWishlist.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  isWishlisted={true}
                  onWishlistToggle={handleRecentWishlistToggle}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6 mt-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Mail className="w-5 h-5 text-rose-400" />
            Activite recente
          </h2>
          {purchases.length > 0 ? (
            <ul className="space-y-2">
              {purchases.slice(0, 5).map((purchase) => (
                <li key={`activity-${purchase.id}`} className="text-sm text-zinc-400">
                  Achat valide: {purchase.product?.title || 'Titre'} ({new Date(purchase.created_at).toLocaleDateString('fr-FR')})
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-8 text-zinc-500">
              Aucune activite recente
            </div>
          )}
        </Card>

        <Modal
          isOpen={Boolean(selectedLicensePurchase)}
          onClose={() => setSelectedLicensePurchase(null)}
          title={selectedLicensePurchase ? `Détails de licence · ${selectedLicenseName}` : 'Détails de licence'}
          description="Résumé des droits et limites associés à cet achat."
          size="lg"
        >
          {selectedLicensePurchase && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-sm text-zinc-400 mb-1">Description</p>
                <p className="text-sm text-zinc-200">{selectedLicenseDescription}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">Streams max</p>
                  <p className="text-sm text-white">{formatLimit(selectedMaxStreams)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">Ventes max</p>
                  <p className="text-sm text-white">{formatLimit(selectedMaxSales)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">Monétisation YouTube</p>
                  <p className="text-sm text-white">{formatBoolean(selectedYoutubeMonetization)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">Clip vidéo autorisé</p>
                  <p className="text-sm text-white">{formatBoolean(selectedMusicVideoAllowed)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">Crédit obligatoire</p>
                  <p className="text-sm text-white">{formatBoolean(selectedCreditRequired)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">Licence exclusive autorisée</p>
                  <p className="text-sm text-white">{formatBoolean(selectedExclusiveAllowed)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-xs text-zinc-500 mb-1">Prix payé</p>
                <p className="text-sm text-white">
                  {formatPrice(selectedLicense?.price ?? selectedLicensePurchase.amount)}
                </p>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
