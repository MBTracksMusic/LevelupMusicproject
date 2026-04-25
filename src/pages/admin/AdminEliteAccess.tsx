import { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import {
  approveLabelRequest,
  deleteRejectedLabelRequest,
  listEliteProductProducersAdmin,
  listEliteProductsAdmin,
  listEliteProfilesAdmin,
  listLabelRequestsAdmin,
  revokeLabelRequest,
  setEliteProducerStatus,
  toggleEliteProduct,
  type EliteAdminProductProducer,
  type EliteAdminProductSummary,
  type EliteAdminProfileSummary,
} from '../../lib/supabase/elite';
import type { LabelRequest } from '../../lib/supabase/types';
import { formatDateTime } from '../../lib/utils/format';

const labelRequestStatusLabels: Record<LabelRequest['status'], string> = {
  pending: 'En attente',
  approved: 'Validee',
  rejected: 'Rejetee',
};

function formatOptionalDate(value: string | null) {
  return value ? formatDateTime(value, 'fr-FR') : '-';
}

function getProducerDisplayName(profile: Pick<EliteAdminProductProducer, 'email' | 'full_name' | 'username'> | undefined) {
  return profile?.username || profile?.full_name || profile?.email || 'Producteur inconnu';
}

function RequestDetailItem({ label, value }: { label: string; value: string | null }) {
  const displayValue = value && value.trim() ? value : '-';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-sm text-zinc-200">{displayValue}</p>
    </div>
  );
}

export function AdminEliteAccessPage() {
  const [requests, setRequests] = useState<LabelRequest[]>([]);
  const [profiles, setProfiles] = useState<EliteAdminProfileSummary[]>([]);
  const [productProducers, setProductProducers] = useState<EliteAdminProductProducer[]>([]);
  const [products, setProducts] = useState<EliteAdminProductSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [profileSearch, setProfileSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productProducerFilter, setProductProducerFilter] = useState('');

  const loadAdminData = async () => {
    setIsLoading(true);
    try {
      const [nextRequests, nextProfiles, nextProductProducers] = await Promise.all([
        listLabelRequestsAdmin(),
        listEliteProfilesAdmin(),
        listEliteProductProducersAdmin(),
      ]);
      const nextProducts = await listEliteProductsAdmin({
        producerIds: nextProductProducers.map((producer) => producer.id),
      });
      setRequests(nextRequests);
      setProfiles(nextProfiles);
      setProductProducers(nextProductProducers);
      setProducts(nextProducts);
    } catch (error) {
      console.error('admin elite access load error', error);
      toast.error('Unable to load elite access admin data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, []);

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? null,
    [requests, selectedRequestId],
  );

  const filteredProfiles = useMemo(() => {
    const search = profileSearch.trim().toLowerCase();
    const promotableProfiles = profiles.filter((profile) => profile.account_type !== 'label');
    if (!search) return promotableProfiles;
    return promotableProfiles.filter((profile) =>
      [profile.email, profile.username ?? '', profile.full_name ?? '', profile.account_type]
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }, [profileSearch, profiles]);

  const productProducersById = useMemo(
    () => new Map(productProducers.map((producer) => [producer.id, producer])),
    [productProducers],
  );

  const productProducerOptions = useMemo(
    () => [
      { value: '', label: 'Tous les producteurs elite' },
      ...productProducers.map((producer) => ({
        value: producer.id,
        label: getProducerDisplayName(producer),
      })),
    ],
    [productProducers],
  );

  useEffect(() => {
    if (productProducerFilter && !productProducersById.has(productProducerFilter)) {
      setProductProducerFilter('');
    }
  }, [productProducerFilter, productProducersById]);

  const filteredProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    return products.filter((product) => {
      if (productProducerFilter && product.producer_id !== productProducerFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [product.title, product.slug, product.product_type].join(' ').toLowerCase().includes(search);
    });
  }, [productProducerFilter, productSearch, products]);

  const handleApproveLabel = async (request: LabelRequest) => {
    setActionKey(`request:${request.id}:approve`);
    try {
      await approveLabelRequest({
        requestId: request.id,
        userId: request.user_id,
      });
      toast.success('Label verified.');
      await loadAdminData();
      setSelectedRequestId(null);
    } catch (error) {
      console.error('approve label request error', error);
      toast.error('Unable to verify the label request.');
    } finally {
      setActionKey(null);
    }
  };

  const handleRevokeLabel = async (request: LabelRequest) => {
    const confirmed = window.confirm("Retirer l'acces label pour cette societe ?");
    if (!confirmed) return;

    setActionKey(`request:${request.id}:revoke`);
    try {
      await revokeLabelRequest({
        requestId: request.id,
        userId: request.user_id,
      });
      toast.success('Acces label retire.');
      await loadAdminData();
      setSelectedRequestId(null);
    } catch (error) {
      console.error('revoke label request error', error);
      toast.error("Impossible de retirer l'acces label.");
    } finally {
      setActionKey(null);
    }
  };

  const handleDeleteRejectedLabel = async (request: LabelRequest) => {
    const confirmed = window.confirm('Supprimer definitivement cette demande label rejetee ?');
    if (!confirmed) return;

    setActionKey(`request:${request.id}:delete`);
    try {
      await deleteRejectedLabelRequest(request.id);
      toast.success('Demande label supprimee.');
      await loadAdminData();
      setSelectedRequestId(null);
    } catch (error) {
      console.error('delete rejected label request error', error);
      toast.error('Impossible de supprimer cette demande label.');
    } finally {
      setActionKey(null);
    }
  };

  const handleSetEliteStatus = async (profile: EliteAdminProfileSummary) => {
    const makeElite = profile.account_type !== 'elite_producer';

    if (makeElite && !profile.is_producer_active) {
      toast.error('Abonnement producteur actif requis pour passer en elite.');
      return;
    }

    setActionKey(`profile:${profile.id}`);
    try {
      await setEliteProducerStatus(profile.id, makeElite);
      toast.success(makeElite ? 'Producteur passe en elite.' : 'Statut elite retire.');
      await loadAdminData();
    } catch (error) {
      console.error('promote elite producer error', error);
      const message =
        makeElite && error instanceof Error && error.message.includes('active_producer_subscription_required')
          ? 'Abonnement producteur actif requis pour passer en elite.'
          : makeElite
            ? 'Impossible de promouvoir ce producteur.'
            : 'Impossible de retirer le statut elite.';
      toast.error(message);
    } finally {
      setActionKey(null);
    }
  };

  const handleToggleElite = async (product: EliteAdminProductSummary) => {
    setActionKey(`product:${product.id}`);
    try {
      await toggleEliteProduct(product.id, !product.is_elite);
      toast.success(product.is_elite ? "Titre retire de l'Elite Hub." : "Titre ajoute a l'Elite Hub.");
      await loadAdminData();
    } catch (error) {
      console.error('toggle elite product error', error);
      toast.error('Impossible de mettre a jour la visibilite du titre prive.');
    } finally {
      setActionKey(null);
    }
  };

  const renderLabelRequestActions = (request: LabelRequest, options?: { showViewButton?: boolean }) => (
    <div className="flex flex-wrap justify-end gap-2">
      {options?.showViewButton && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSelectedRequestId(request.id)}
          leftIcon={<Eye className="h-4 w-4" />}
        >
          Voir
        </Button>
      )}
      {request.status === 'pending' && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void handleApproveLabel(request)}
          isLoading={actionKey === `request:${request.id}:approve`}
          disabled={actionKey !== null}
        >
          Valider le label
        </Button>
      )}
      {request.status === 'approved' && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleRevokeLabel(request)}
          isLoading={actionKey === `request:${request.id}:revoke`}
          disabled={actionKey !== null}
        >
          Retirer le label
        </Button>
      )}
      {request.status === 'rejected' && (
        <Button
          size="sm"
          variant="danger"
          onClick={() => void handleDeleteRejectedLabel(request)}
          isLoading={actionKey === `request:${request.id}:delete`}
          disabled={actionKey !== null}
        >
          Supprimer
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Acces prive labels et producteurs elite</CardTitle>
          <CardDescription>
            Gerez les demandes labels, les comptes elite et les beats visibles dans l'espace prive.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            Ces reglages etendent l'acces prive sans modifier la marketplace publique.
          </p>
          <Button variant="outline" onClick={() => void loadAdminData()} isLoading={isLoading}>
            Actualiser
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demandes de labels</CardTitle>
          <CardDescription>Consultez les demandes d'acces prive et validez les comptes labels.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-16 rounded-lg bg-zinc-950 border border-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-zinc-400">Aucune demande de label pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-zinc-500">
                  <tr className="border-b border-zinc-800">
                    <th className="py-2 text-left">Societe</th>
                    <th className="py-2 text-left">Email</th>
                    <th className="py-2 text-left">Statut</th>
                    <th className="py-2 text-left">Message</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id} className="border-b border-zinc-900 align-top">
                      <td className="py-3 pr-4 text-white">{request.company_name}</td>
                      <td className="py-3 pr-4 text-zinc-300">{request.email}</td>
                      <td className="py-3 pr-4 text-zinc-300">{labelRequestStatusLabels[request.status]}</td>
                      <td className="py-3 pr-4 text-zinc-400">
                        <span className="block max-w-xs truncate" title={request.message}>
                          {request.message || '-'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {renderLabelRequestActions(request, { showViewButton: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={Boolean(selectedRequest)}
        onClose={() => setSelectedRequestId(null)}
        title="Demande label complete"
        description="Informations transmises par le label et suivi de traitement."
        size="xl"
      >
        {selectedRequest && (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <RequestDetailItem label="Societe" value={selectedRequest.company_name} />
              <RequestDetailItem label="Email" value={selectedRequest.email} />
              <RequestDetailItem label="Statut" value={labelRequestStatusLabels[selectedRequest.status]} />
              <RequestDetailItem label="Date de demande" value={formatOptionalDate(selectedRequest.created_at)} />
              <RequestDetailItem label="Derniere mise a jour" value={formatOptionalDate(selectedRequest.updated_at)} />
              <RequestDetailItem label="Revisee le" value={formatOptionalDate(selectedRequest.reviewed_at)} />
              <RequestDetailItem label="Revisee par" value={selectedRequest.reviewed_by} />
              <RequestDetailItem label="ID utilisateur" value={selectedRequest.user_id} />
              <RequestDetailItem label="ID demande" value={selectedRequest.id} />
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Message complet</p>
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm leading-6 text-zinc-200">
                {selectedRequest.message || '-'}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
              <Button size="sm" variant="ghost" onClick={() => setSelectedRequestId(null)}>
                Fermer
              </Button>
              {renderLabelRequestActions(selectedRequest)}
            </div>
          </div>
        )}
      </Modal>

      <Card>
        <CardHeader>
          <CardTitle>Promotion producteur elite</CardTitle>
          <CardDescription>Donnez ou retirez l'acces elite a un producteur existant.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Rechercher un producteur"
            value={profileSearch}
            onChange={(event) => setProfileSearch(event.target.value)}
            placeholder="email, pseudo, nom complet"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 text-left">Utilisateur</th>
                  <th className="py-2 text-left">Role</th>
                  <th className="py-2 text-left">Type de compte</th>
                  <th className="py-2 text-left">Abonnement actif</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => (
                  (() => {
                    const isEliteProducer = profile.account_type === 'elite_producer';
                    const canPromote = profile.account_type === 'producer' && profile.is_producer_active;
                    const canRemoveElite = isEliteProducer;
                    const canManageEliteStatus = canPromote || canRemoveElite;
                    const actionLabel = isEliteProducer ? 'Retirer elite' : 'Promouvoir';
                    const actionTitle =
                      !isEliteProducer && !profile.is_producer_active
                        ? 'Abonnement producteur actif requis'
                        : actionLabel;

                    return (
                      <tr key={profile.id} className="border-b border-zinc-900">
                        <td className="py-3 pr-4">
                          <div className="text-white">{profile.full_name || profile.username || profile.email}</div>
                          <div className="text-zinc-400">{profile.email}</div>
                        </td>
                        <td className="py-3 pr-4 text-zinc-300">{profile.role}</td>
                        <td className="py-3 pr-4 text-zinc-300">{profile.account_type}</td>
                        <td className="py-3 pr-4 text-zinc-300">{profile.is_producer_active ? 'oui' : 'non'}</td>
                        <td className="py-3 text-right">
                          <Button
                            size="sm"
                            variant={isEliteProducer ? 'outline' : 'secondary'}
                            onClick={() => void handleSetEliteStatus(profile)}
                            isLoading={actionKey === `profile:${profile.id}`}
                            disabled={!canManageEliteStatus}
                            title={actionTitle}
                          >
                            {actionLabel}
                          </Button>
                        </td>
                      </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Beats prives</CardTitle>
              <CardDescription>Choisissez les titres publies visibles dans l'Elite Hub et retirez-les si besoin.</CardDescription>
            </div>
            <Link to="/elite-hub">
              <Button variant="outline" size="sm">Ouvrir Elite Hub</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
            <Input
              label="Rechercher un beat"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="titre ou slug"
            />
            <Select
              label="Filtrer par producteur"
              value={productProducerFilter}
              onChange={(event) => setProductProducerFilter(event.target.value)}
              options={productProducerOptions}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 text-left">Titre</th>
                  <th className="py-2 text-left">Producteur</th>
                  <th className="py-2 text-left">Type</th>
                  <th className="py-2 text-left">Statut</th>
                  <th className="py-2 text-left">Exclusif</th>
                  <th className="py-2 text-left">Publie</th>
                  <th className="py-2 text-left">Prive</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const productProducer = productProducersById.get(product.producer_id);

                  return (
                    <tr key={product.id} className="border-b border-zinc-900">
                      <td className="py-3 pr-4">
                        <div className="text-white">{product.title}</div>
                        <div className="text-zinc-400">{product.slug}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-zinc-300">{getProducerDisplayName(productProducer)}</div>
                        {productProducer?.email && <div className="text-zinc-500">{productProducer.email}</div>}
                      </td>
                      <td className="py-3 pr-4 text-zinc-300">{product.product_type}</td>
                      <td className="py-3 pr-4 text-zinc-300">{product.status}</td>
                      <td className="py-3 pr-4 text-zinc-300">{product.is_exclusive ? 'yes' : 'no'}</td>
                      <td className="py-3 pr-4 text-zinc-300">{product.is_published ? 'yes' : 'no'}</td>
                      <td className="py-3 pr-4 text-zinc-300">{product.is_elite ? 'yes' : 'no'}</td>
                      <td className="py-3 text-right">
                        <Button
                          size="sm"
                          variant={product.is_elite ? 'outline' : 'secondary'}
                          onClick={() => void handleToggleElite(product)}
                          isLoading={actionKey === `product:${product.id}`}
                        >
                          {product.is_elite ? 'Retirer' : 'Ajouter'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminEliteAccessPage;
