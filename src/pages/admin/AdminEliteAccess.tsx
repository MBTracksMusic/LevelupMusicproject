import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../lib/auth/hooks';
import {
  approveLabelRequest,
  listEliteProductsAdmin,
  listEliteProfilesAdmin,
  listLabelRequestsAdmin,
  promoteEliteProducer,
  toggleEliteProduct,
  type EliteAdminProductSummary,
  type EliteAdminProfileSummary,
} from '../../lib/supabase/elite';
import type { LabelRequest } from '../../lib/supabase/types';

export function AdminEliteAccessPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<LabelRequest[]>([]);
  const [profiles, setProfiles] = useState<EliteAdminProfileSummary[]>([]);
  const [products, setProducts] = useState<EliteAdminProductSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [profileSearch, setProfileSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  const loadAdminData = async () => {
    setIsLoading(true);
    try {
      const [nextRequests, nextProfiles, nextProducts] = await Promise.all([
        listLabelRequestsAdmin(),
        listEliteProfilesAdmin(),
        listEliteProductsAdmin(),
      ]);
      setRequests(nextRequests);
      setProfiles(nextProfiles);
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

  const filteredProfiles = useMemo(() => {
    const search = profileSearch.trim().toLowerCase();
    if (!search) return profiles;
    return profiles.filter((profile) =>
      [profile.email, profile.username ?? '', profile.full_name ?? '', profile.account_type]
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }, [profileSearch, profiles]);

  const filteredProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    if (!search) return products;
    return products.filter((product) =>
      [product.title, product.slug].join(' ').toLowerCase().includes(search),
    );
  }, [productSearch, products]);

  const handleApproveLabel = async (request: LabelRequest) => {
    if (!user?.id) return;
    setActionKey(`request:${request.id}`);
    try {
      await approveLabelRequest({
        requestId: request.id,
        userId: request.user_id,
        reviewerId: user.id,
      });
      toast.success('Label verified.');
      await loadAdminData();
    } catch (error) {
      console.error('approve label request error', error);
      toast.error('Unable to verify the label request.');
    } finally {
      setActionKey(null);
    }
  };

  const handlePromoteElite = async (profile: EliteAdminProfileSummary) => {
    setActionKey(`profile:${profile.id}`);
    try {
      await promoteEliteProducer(profile.id);
      toast.success('Producer promoted to elite_producer.');
      await loadAdminData();
    } catch (error) {
      console.error('promote elite producer error', error);
      toast.error('Unable to promote this producer.');
    } finally {
      setActionKey(null);
    }
  };

  const handleToggleElite = async (product: EliteAdminProductSummary) => {
    setActionKey(`product:${product.id}`);
    try {
      await toggleEliteProduct(product.id, !product.is_elite);
      toast.success(product.is_elite ? 'Beat removed from Elite Hub.' : 'Beat added to Elite Hub.');
      await loadAdminData();
    } catch (error) {
      console.error('toggle elite product error', error);
      toast.error('Unable to update elite beat visibility.');
    } finally {
      setActionKey(null);
    }
  };

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
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id} className="border-b border-zinc-900 align-top">
                      <td className="py-3 pr-4 text-white">{request.company_name}</td>
                      <td className="py-3 pr-4 text-zinc-300">{request.email}</td>
                      <td className="py-3 pr-4 text-zinc-300">{request.status}</td>
                      <td className="py-3 pr-4 text-zinc-400 max-w-md whitespace-pre-wrap">{request.message}</td>
                      <td className="py-3 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleApproveLabel(request)}
                          isLoading={actionKey === `request:${request.id}`}
                          disabled={request.status !== 'pending'}
                        >
                          Valider le label
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Promotion producteur elite</CardTitle>
          <CardDescription>Donnez l'acces elite a un producteur existant.</CardDescription>
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
                  <th className="py-2 text-left">Verifie</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => (
                  <tr key={profile.id} className="border-b border-zinc-900">
                    <td className="py-3 pr-4">
                      <div className="text-white">{profile.full_name || profile.username || profile.email}</div>
                      <div className="text-zinc-400">{profile.email}</div>
                    </td>
                    <td className="py-3 pr-4 text-zinc-300">{profile.role}</td>
                    <td className="py-3 pr-4 text-zinc-300">{profile.account_type}</td>
                    <td className="py-3 pr-4 text-zinc-300">{profile.is_verified ? 'yes' : 'no'}</td>
                    <td className="py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handlePromoteElite(profile)}
                        isLoading={actionKey === `profile:${profile.id}`}
                        disabled={profile.account_type === 'elite_producer'}
                      >
                        Promouvoir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Beats prives</CardTitle>
          <CardDescription>Choisissez les beats publies visibles dans l'Elite Hub.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Rechercher un beat"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="titre ou slug"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 text-left">Beat</th>
                  <th className="py-2 text-left">Statut</th>
                  <th className="py-2 text-left">Publie</th>
                  <th className="py-2 text-left">Prive</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="border-b border-zinc-900">
                    <td className="py-3 pr-4">
                      <div className="text-white">{product.title}</div>
                      <div className="text-zinc-400">{product.slug}</div>
                    </td>
                    <td className="py-3 pr-4 text-zinc-300">{product.status}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminEliteAccessPage;
