import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, CreditCard, Euro, Inbox, Newspaper, Receipt, Settings2, ShoppingCart, Swords } from 'lucide-react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { AnalyticsAlertsPanel } from '../../components/system/AnalyticsAlertsPanel';
import {
  getAverageOrderValue,
  getProductPerformance,
  getRevenueToday,
  getTopProducts,
  getTotalPurchases,
  getTotalRevenue,
  type AnalyticsDateRange,
  type MetricWithGrowth,
  type ProductPerformanceRow,
  type TopProductAnalytics,
} from '../../lib/analyticsService';
import {
  evaluateAnalyticsAlerts,
  getActiveAlerts,
  resolveAnalyticsAlert,
  saveAlerts,
  type AnalyticsAlertRecord,
} from '../../lib/analyticsAlertsService';
import { getFunnelData } from '../../lib/funnelService';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import { useMaintenanceModeContext } from '../../lib/supabase/MaintenanceModeContext';

function toDatetimeLocalValue(value: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoStringOrNull(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid-launch-date');
  }

  return date.toISOString();
}

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const {
    maintenance,
    launchDate,
    launchVideoUrl,
    updatedAt,
    isLoading,
    updateMaintenanceMode,
    updateSettings,
  } = useMaintenanceModeContext();
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);
  const [launchDateInput, setLaunchDateInput] = useState(() => toDatetimeLocalValue(launchDate));
  const [launchVideoUrlInput, setLaunchVideoUrlInput] = useState(() => launchVideoUrl ?? '');
  const [isSavingLaunchDate, setIsSavingLaunchDate] = useState(false);
  const [isSavingLaunchVideoUrl, setIsSavingLaunchVideoUrl] = useState(false);
  const [dateRange, setDateRange] = useState<AnalyticsDateRange>('7d');
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [totalRevenue, setTotalRevenue] = useState<MetricWithGrowth>({ value: 0, growth: 0 });
  const [totalPurchases, setTotalPurchases] = useState<MetricWithGrowth>({ value: 0, growth: 0 });
  const [averageOrderValue, setAverageOrderValue] = useState<MetricWithGrowth>({ value: 0, growth: 0 });
  const [revenueToday, setRevenueToday] = useState(0);
  const [topProducts, setTopProducts] = useState<TopProductAnalytics[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceRow[]>([]);
  const [isFunnelLoading, setIsFunnelLoading] = useState(true);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [funnelViews, setFunnelViews] = useState(0);
  const [funnelCheckouts, setFunnelCheckouts] = useState(0);
  const [funnelPurchases, setFunnelPurchases] = useState(0);
  const [activeAlerts, setActiveAlerts] = useState<AnalyticsAlertRecord[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [isAlertsLoading, setIsAlertsLoading] = useState(true);
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [isSendingWaitlistCampaign, setIsSendingWaitlistCampaign] = useState(false);

  useEffect(() => {
    if (!isSavingLaunchDate) {
      setLaunchDateInput(toDatetimeLocalValue(launchDate));
    }
  }, [isSavingLaunchDate, launchDate]);

  useEffect(() => {
    if (!isSavingLaunchVideoUrl) {
      setLaunchVideoUrlInput(launchVideoUrl ?? '');
    }
  }, [isSavingLaunchVideoUrl, launchVideoUrl]);

  useEffect(() => {
    let isCancelled = false;

    const loadAnalytics = async () => {
      setIsAnalyticsLoading(true);
      setAnalyticsError(null);

      try {
        const [
          nextTotalRevenue,
          nextTotalPurchases,
          nextAverageOrderValue,
          nextRevenueToday,
          nextTopProducts,
          nextProductPerformance,
        ] = await Promise.all([
          getTotalRevenue(dateRange),
          getTotalPurchases(dateRange),
          getAverageOrderValue(dateRange),
          getRevenueToday(dateRange),
          getTopProducts(dateRange),
          getProductPerformance(dateRange),
        ]);

        if (isCancelled) {
          return;
        }

        setTotalRevenue(nextTotalRevenue);
        setTotalPurchases(nextTotalPurchases);
        setAverageOrderValue(nextAverageOrderValue);
        setRevenueToday(nextRevenueToday);
        setTopProducts(nextTopProducts);
        setProductPerformance(nextProductPerformance);
      } catch {
        if (isCancelled) {
          return;
        }

        setAnalyticsError("Impossible de charger les analytics business.");
      } finally {
        if (!isCancelled) {
          setIsAnalyticsLoading(false);
        }
      }
    };

    void loadAnalytics();

    return () => {
      isCancelled = true;
    };
  }, [dateRange]);

  useEffect(() => {
    let isCancelled = false;

    const loadFunnel = async () => {
      setIsFunnelLoading(true);
      setFunnelError(null);

      try {
        const funnel = await getFunnelData(dateRange);

        if (isCancelled) {
          return;
        }

        setFunnelViews(funnel.views);
        setFunnelCheckouts(funnel.checkouts);
        setFunnelPurchases(funnel.purchases);
      } catch {
        if (isCancelled) {
          return;
        }

        setFunnelError('Impossible de charger le funnel de conversion.');
      } finally {
        if (!isCancelled) {
          setIsFunnelLoading(false);
        }
      }
    };

    void loadFunnel();

    return () => {
      isCancelled = true;
    };
  }, [dateRange]);

  useEffect(() => {
    let isCancelled = false;

    const syncAlerts = async () => {
      if (isAnalyticsLoading || isFunnelLoading || analyticsError || funnelError) {
        return;
      }

      setIsAlertsLoading(true);
      setAlertsError(null);

      try {
        const evaluatedAlerts = evaluateAnalyticsAlerts({
          conversionRate: funnelViews > 0 ? funnelPurchases / funnelViews : 0,
          revenueGrowth: totalRevenue.growth,
          purchases: totalPurchases.value,
        });

        await saveAlerts(evaluatedAlerts);
        const nextAlerts = await getActiveAlerts();

        if (isCancelled) {
          return;
        }

        setActiveAlerts(nextAlerts);
      } catch {
        if (isCancelled) {
          return;
        }

        setAlertsError("Impossible de synchroniser les alertes analytics.");
      } finally {
        if (!isCancelled) {
          setIsAlertsLoading(false);
        }
      }
    };

    void syncAlerts();

    return () => {
      isCancelled = true;
    };
  }, [
    analyticsError,
    dateRange,
    funnelError,
    funnelPurchases,
    funnelViews,
    isAnalyticsLoading,
    isFunnelLoading,
    totalPurchases.value,
    totalRevenue.growth,
  ]);

  const formatCurrency = (value: number) => new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(value);

  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
  const formatGrowth = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}% vs période précédente`;
  const getSafeConversion = (from: number, to: number) => (from > 0 ? to / from : 0);
  const getDropOffClassName = (rate: number) => {
    if (rate >= 0.35) {
      return 'text-emerald-300';
    }

    if (rate >= 0.15) {
      return 'text-amber-300';
    }

    return 'text-rose-300';
  };
  const getGrowthClassName = (growth: number) => (growth >= 0 ? 'text-emerald-300' : 'text-rose-300');

  const viewToCheckoutRate = getSafeConversion(funnelViews, funnelCheckouts);
  const checkoutToPurchaseRate = getSafeConversion(funnelCheckouts, funnelPurchases);
  const viewToPurchaseRate = getSafeConversion(funnelViews, funnelPurchases);
  const dateRangeOptions: Array<{ value: AnalyticsDateRange; label: string }> = [
    { value: '7d', label: '7 jours' },
    { value: '30d', label: '30 jours' },
    { value: 'all', label: 'Tout' },
  ];
  const bestPerformers = productPerformance.slice(0, 5);
  const worstPerformers = [...productPerformance]
    .filter((product) => product.views > 0)
    .sort((a, b) => {
      if (a.conversionRate !== b.conversionRate) {
        return a.conversionRate - b.conversionRate;
      }

      return b.views - a.views;
    })
    .slice(0, 5);

  const handleMaintenanceToggle = async () => {
    setIsSavingMaintenance(true);

    try {
      const nextValue = !maintenance;
      await updateMaintenanceMode(nextValue);
      toast.success(nextValue ? 'Mode maintenance activé.' : 'Mode maintenance désactivé.');
    } catch {
      toast.error("Impossible de mettre à jour le mode maintenance.");
    } finally {
      setIsSavingMaintenance(false);
    }
  };

  const handleLaunchDateSave = async () => {
    setIsSavingLaunchDate(true);

    try {
      await updateSettings({ launch_date: toIsoStringOrNull(launchDateInput) });
      toast.success(launchDateInput ? 'Date de lancement enregistrée.' : 'Date de lancement supprimée.');
    } catch {
      toast.error("Impossible d'enregistrer la date de lancement.");
    } finally {
      setIsSavingLaunchDate(false);
    }
  };

  const handleLaunchDateClear = async () => {
    setIsSavingLaunchDate(true);

    try {
      setLaunchDateInput('');
      await updateSettings({ launch_date: null });
      toast.success('Date de lancement supprimée.');
    } catch {
      toast.error("Impossible de supprimer la date de lancement.");
    } finally {
      setIsSavingLaunchDate(false);
    }
  };

  const handleLaunchVideoUrlSave = async () => {
    setIsSavingLaunchVideoUrl(true);

    try {
      const trimmedLaunchVideoUrl = launchVideoUrlInput.trim();
      await updateSettings({ launch_video_url: trimmedLaunchVideoUrl || null });
      toast.success(trimmedLaunchVideoUrl ? 'URL vidéo enregistrée.' : 'URL vidéo supprimée.');
    } catch {
      toast.error("Impossible d'enregistrer l'URL vidéo.");
    } finally {
      setIsSavingLaunchVideoUrl(false);
    }
  };

  const handleSendWaitlistCampaign = async () => {
    if (isSendingWaitlistCampaign) {
      return;
    }

    setIsSendingWaitlistCampaign(true);

    try {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: boolean }>(
        'send-waitlist-campaign',
      );

      if (error || !data?.success) {
        alert("Erreur lors de l'envoi");
        return;
      }

      alert('Campagne envoyée 🚀');
    } catch {
      alert("Erreur lors de l'envoi");
    } finally {
      setIsSendingWaitlistCampaign(false);
    }
  };

  const handleLaunchVideoUrlClear = async () => {
    setIsSavingLaunchVideoUrl(true);

    try {
      setLaunchVideoUrlInput('');
      await updateSettings({ launch_video_url: null });
      toast.success('URL vidéo supprimée.');
    } catch {
      toast.error("Impossible de supprimer l'URL vidéo.");
    } finally {
      setIsSavingLaunchVideoUrl(false);
    }
  };

  const handleResolveAlert = async (id: string) => {
    setResolvingAlertId(id);

    try {
      await resolveAnalyticsAlert(id);
      const nextAlerts = await getActiveAlerts();
      setActiveAlerts(nextAlerts);
    } catch {
      toast.error("Impossible de résoudre l'alerte.");
    } finally {
      setResolvingAlertId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card className="md:col-span-2 border-zinc-800">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-white">Période d&apos;analyse</p>
            <p className="mt-1 text-sm text-zinc-400">
              Filtre les KPIs, le funnel et les comparaisons de croissance.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {dateRangeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDateRange(option.value)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  dateRange === option.value
                    ? 'border-rose-500 bg-rose-500/10 text-white'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Chiffre d&apos;affaires</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {isAnalyticsLoading ? '...' : formatCurrency(totalRevenue.value)}
              </p>
              <p className="mt-2 text-sm text-zinc-400">Revenu total confirmé</p>
              <p className={`mt-1 text-xs font-medium ${getGrowthClassName(totalRevenue.growth)}`}>
                {isAnalyticsLoading ? '...' : formatGrowth(totalRevenue.growth)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-300">
              <Euro className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Achats</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {isAnalyticsLoading ? '...' : totalPurchases.value}
              </p>
              <p className="mt-2 text-sm text-zinc-400">Nombre total de commandes</p>
              <p className={`mt-1 text-xs font-medium ${getGrowthClassName(totalPurchases.growth)}`}>
                {isAnalyticsLoading ? '...' : formatGrowth(totalPurchases.growth)}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-300">
              <Receipt className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Panier moyen</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {isAnalyticsLoading ? '...' : formatCurrency(averageOrderValue.value)}
              </p>
              <p className="mt-2 text-sm text-zinc-400">Valeur moyenne par achat</p>
              <p className={`mt-1 text-xs font-medium ${getGrowthClassName(averageOrderValue.growth)}`}>
                {isAnalyticsLoading ? '...' : formatGrowth(averageOrderValue.growth)}
              </p>
            </div>
            <div className="rounded-2xl border border-orange-500/20 bg-orange-500/10 p-3 text-orange-300">
              <CreditCard className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Aujourd&apos;hui</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {isAnalyticsLoading ? '...' : formatCurrency(revenueToday)}
              </p>
              <p className="mt-2 text-sm text-zinc-400">Revenu généré ce jour</p>
            </div>
            <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-sky-300">
              <BarChart3 className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <AnalyticsAlertsPanel
        alerts={activeAlerts}
        isLoading={isAlertsLoading}
        error={alertsError}
        onResolve={handleResolveAlert}
        resolvingId={resolvingAlertId}
      />

      <Card className="md:col-span-2 border-zinc-800">
        <CardHeader>
          <CardTitle>Top produits</CardTitle>
          <CardDescription>
            Les 5 produits qui génèrent le plus de chiffre d&apos;affaires.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analyticsError ? (
            <p className="text-sm text-red-400">{analyticsError}</p>
          ) : isAnalyticsLoading ? (
            <p className="text-sm text-zinc-400">Chargement des analytics business...</p>
          ) : topProducts.length === 0 ? (
            <p className="text-sm text-zinc-400">Aucune vente confirmée pour le moment.</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((product, index) => (
                <div
                  key={product.productId}
                  className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-500">#{index + 1}</p>
                    <p className="truncate text-base font-medium text-white">{product.productName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <span className="text-zinc-400">{product.salesCount} ventes</span>
                    <span className="font-medium text-emerald-300">{formatCurrency(product.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2 border-zinc-800">
        <CardHeader>
          <CardTitle>Performance produits</CardTitle>
          <CardDescription>
            Vues, achats et conversion par produit pour identifier les meilleurs et les plus faibles.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Best performers</p>
            {isAnalyticsLoading ? (
              <p className="text-sm text-zinc-400">Chargement des performances produits...</p>
            ) : bestPerformers.length === 0 ? (
              <p className="text-sm text-zinc-400">Aucune donnée produit disponible.</p>
            ) : (
              bestPerformers.map((product) => (
                <div
                  key={`best-${product.productId}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{product.productName}</p>
                      <p className="mt-1 text-xs text-zinc-500">/{product.slug}</p>
                    </div>
                    <span className="text-sm font-semibold text-emerald-300">
                      {formatPercent(product.conversionRate)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
                    <span>{product.views} vues</span>
                    <span>{product.purchases} achats</span>
                    <span>{formatCurrency(product.price)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Worst performers</p>
            {isAnalyticsLoading ? (
              <p className="text-sm text-zinc-400">Chargement des performances produits...</p>
            ) : worstPerformers.length === 0 ? (
              <p className="text-sm text-zinc-400">Aucune donnée produit disponible.</p>
            ) : (
              worstPerformers.map((product) => (
                <div
                  key={`worst-${product.productId}`}
                  className={`rounded-xl border px-4 py-4 ${
                    product.lowConversion
                      ? 'border-rose-500/30 bg-rose-500/5'
                      : 'border-zinc-800 bg-zinc-950/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{product.productName}</p>
                      <p className="mt-1 text-xs text-zinc-500">/{product.slug}</p>
                    </div>
                    <span className={product.lowConversion ? 'text-sm font-semibold text-rose-300' : 'text-sm font-semibold text-amber-300'}>
                      {formatPercent(product.conversionRate)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
                    <span>{product.views} vues</span>
                    <span>{product.purchases} achats</span>
                    <span>{formatCurrency(product.price)}</span>
                  </div>
                  {product.lowConversion ? (
                    <p className="mt-2 text-xs font-medium text-rose-300">Low conversion: plus de 100 vues sans achat.</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-rose-400" />
            Funnel de conversion
          </CardTitle>
          <CardDescription>
            Vue d&apos;ensemble du parcours produit, du trafic jusqu&apos;à l&apos;achat confirmé.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnelError ? (
            <p className="text-sm text-red-400">{funnelError}</p>
          ) : isFunnelLoading ? (
            <p className="text-sm text-zinc-400">Chargement du funnel...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Views</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{funnelViews}</p>
                  <p className="mt-2 text-sm text-zinc-400">Vues produit estimées</p>
                </div>

                <div className="hidden items-center justify-center lg:flex">
                  <div className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm font-medium text-zinc-300">
                    {formatPercent(viewToCheckoutRate)}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Checkout</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{funnelCheckouts}</p>
                  <p className={`mt-2 text-sm ${getDropOffClassName(viewToCheckoutRate)}`}>
                    Conversion vues → checkout
                  </p>
                </div>

                <div className="hidden items-center justify-center lg:flex">
                  <div className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm font-medium text-zinc-300">
                    {formatPercent(checkoutToPurchaseRate)}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Purchases</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{funnelPurchases}</p>
                  <p className={`mt-2 text-sm ${getDropOffClassName(checkoutToPurchaseRate)}`}>
                    Conversion checkout → achat
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Views → Checkout</p>
                  <p className={`mt-2 text-lg font-semibold ${getDropOffClassName(viewToCheckoutRate)}`}>
                    {formatPercent(viewToCheckoutRate)}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Checkout → Purchase</p>
                  <p className={`mt-2 text-lg font-semibold ${getDropOffClassName(checkoutToPurchaseRate)}`}>
                    {formatPercent(checkoutToPurchaseRate)}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Views → Purchase</p>
                  <p className={`mt-2 text-lg font-semibold ${getDropOffClassName(viewToPurchaseRate)}`}>
                    {formatPercent(viewToPurchaseRate)}
                  </p>
                </div>
              </div>

              <p className="text-xs text-zinc-500">
                Les achats proviennent de Supabase. Les vues et checkouts utilisent un fallback structuré en attendant le branchement GA4 côté reporting admin.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2 border-zinc-800">
        <CardHeader className="mb-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-rose-400" />
                Maintenance globale
              </CardTitle>
              <CardDescription className="mt-2">
                Active ou désactive le blocage global du site en temps réel, sans redéploiement.
              </CardDescription>
            </div>
            <div className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300">
              {isLoading ? 'Chargement...' : maintenance ? 'ON' : 'OFF'}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pt-4">
          <label className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Mode maintenance</p>
              <p className="text-sm text-zinc-400">
                {maintenance
                  ? 'Le site public est actuellement bloqué pour les visiteurs.'
                  : 'Le site public est actuellement accessible.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={maintenance}
              aria-label="Basculer le mode maintenance"
              onClick={handleMaintenanceToggle}
              disabled={isLoading || isSavingMaintenance}
              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                maintenance
                  ? 'border-rose-500 bg-rose-500/90'
                  : 'border-zinc-700 bg-zinc-800'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  maintenance ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
            <span>
              Dernière mise à jour : {updatedAt ? new Date(updatedAt).toLocaleString() : 'inconnue'}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={handleSendWaitlistCampaign}
                isLoading={isSendingWaitlistCampaign}
                disabled={isLoading}
              >
                🚀 Envoyer la campagne
              </Button>
              <Button
                variant={maintenance ? 'secondary' : 'primary'}
                onClick={handleMaintenanceToggle}
                isLoading={isSavingMaintenance}
                disabled={isLoading}
              >
                {maintenance ? 'Désactiver la maintenance' : 'Activer la maintenance'}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium text-white">Date de lancement</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Laisse vide pour le mode simple. Renseigne une date pour afficher le mode lancement avec compte à rebours.
                </p>
              </div>

              <Input
                type="datetime-local"
                label="Lancement prévu"
                value={launchDateInput}
                onChange={(event) => setLaunchDateInput(event.target.value)}
                disabled={isLoading || isSavingLaunchDate}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={handleLaunchDateSave}
                  isLoading={isSavingLaunchDate}
                  disabled={isLoading}
                >
                  Enregistrer la date
                </Button>
                <Button
                  variant="outline"
                  onClick={handleLaunchDateClear}
                  disabled={isLoading || isSavingLaunchDate || !launchDate}
                >
                  Vider la date
                </Button>
                <span className="text-sm text-zinc-500">
                  {launchDate
                    ? `Date active : ${new Date(launchDate).toLocaleString()}`
                    : 'Aucune date active'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium text-white">Vidéo de lancement</p>
                <p className="mt-1 text-sm text-zinc-400">
                  URL facultative. Si elle est vide, aucune vidéo ne sera affichée sur l'écran de maintenance.
                </p>
              </div>

              <Input
                type="url"
                label="URL vidéo"
                value={launchVideoUrlInput}
                onChange={(event) => setLaunchVideoUrlInput(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={isLoading || isSavingLaunchVideoUrl}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={handleLaunchVideoUrlSave}
                  isLoading={isSavingLaunchVideoUrl}
                  disabled={isLoading}
                >
                  Enregistrer l'URL
                </Button>
                <Button
                  variant="outline"
                  onClick={handleLaunchVideoUrlClear}
                  disabled={isLoading || isSavingLaunchVideoUrl || !launchVideoUrl}
                >
                  Vider l'URL
                </Button>
                <span className="text-sm text-zinc-500">
                  {launchVideoUrl ? 'Une vidéo est actuellement configurée' : 'Aucune vidéo active'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Link to="/admin/news" className="group">
        <Card className="h-full border-zinc-800 transition-colors hover:border-rose-500/60">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="h-5 w-5 text-rose-400" />
                  {t('admin.dashboard.newsTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.newsDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-500 transition-colors group-hover:text-white" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/battles" className="group">
        <Card className="h-full border-zinc-800 transition-colors hover:border-rose-500/60">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="h-5 w-5 text-rose-400" />
                  {t('admin.dashboard.battlesTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.battlesDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-500 transition-colors group-hover:text-white" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/messages" className="group">
        <Card className="h-full border-zinc-800 transition-colors hover:border-rose-500/60">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="h-5 w-5 text-rose-400" />
                  {t('admin.dashboard.messagesTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.messagesDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-500 transition-colors group-hover:text-white" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/beat-analytics" className="group">
        <Card className="h-full border-zinc-800 transition-colors hover:border-rose-500/60">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-rose-400" />
                  {t('admin.dashboard.beatAnalyticsTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.beatAnalyticsDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-500 transition-colors group-hover:text-white" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
