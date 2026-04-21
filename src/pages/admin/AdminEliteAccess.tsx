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
          <CardTitle>Elite Producer & Label Access</CardTitle>
          <CardDescription>
            Minimal admin controls for private label verification, elite producer promotion, and elite beat curation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            These actions extend the private ecosystem without touching the public marketplace logic.
          </p>
          <Button variant="outline" onClick={() => void loadAdminData()} isLoading={isLoading}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Label Requests</CardTitle>
          <CardDescription>Approve pending label requests and verify the requesting account.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-16 rounded-lg bg-zinc-950 border border-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-zinc-400">No label requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-zinc-500">
                  <tr className="border-b border-zinc-800">
                    <th className="py-2 text-left">Company</th>
                    <th className="py-2 text-left">Email</th>
                    <th className="py-2 text-left">Status</th>
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
                          Verify label
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
          <CardTitle>Producer Promotion</CardTitle>
          <CardDescription>Promote an existing producer account to elite_producer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Search producer"
            value={profileSearch}
            onChange={(event) => setProfileSearch(event.target.value)}
            placeholder="email, username, full name"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 text-left">User</th>
                  <th className="py-2 text-left">Role</th>
                  <th className="py-2 text-left">Account type</th>
                  <th className="py-2 text-left">Verified</th>
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
                        Promote
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
          <CardTitle>Elite Beats</CardTitle>
          <CardDescription>Toggle which published beats are visible inside the Elite Hub.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Search beat"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="title or slug"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 text-left">Beat</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-left">Published</th>
                  <th className="py-2 text-left">Elite</th>
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
                        {product.is_elite ? 'Remove elite' : 'Mark elite'}
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
