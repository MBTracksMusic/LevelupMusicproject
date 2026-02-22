import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, MailQuestion, Swords, XCircle } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';
import type { BattleStatus } from '../lib/supabase/types';

interface ProducerOption {
  id: string;
  username: string | null;
}

interface ProductOption {
  id: string;
  title: string;
}

interface ManagedBattle {
  id: string;
  title: string;
  slug: string;
  status: BattleStatus;
  rejection_reason: string | null;
  accepted_at: string | null;
  admin_validated_at: string | null;
  voting_ends_at: string | null;
  votes_producer1: number;
  votes_producer2: number;
  producer2?: { username: string | null };
  product1?: { title: string };
  product2?: { title: string };
}

interface IncomingBattle {
  id: string;
  title: string;
  slug: string;
  status: BattleStatus;
  response_deadline: string | null;
  producer1?: { username: string | null };
  product1?: { title: string };
  product2?: { title: string };
}

const badgeByStatus: Record<BattleStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'premium'> = {
  pending: 'warning',
  pending_acceptance: 'warning',
  awaiting_admin: 'info',
  approved: 'info',
  active: 'success',
  voting: 'success',
  completed: 'info',
  cancelled: 'danger',
  rejected: 'danger',
};

function toRpcErrorMessage(message: string) {
  if (message.includes('rejection_reason_required')) return 'La raison du refus est obligatoire.';
  if (message.includes('response_already_recorded')) return 'Une reponse a deja ete enregistree.';
  if (message.includes('battle_not_waiting_for_response')) return 'Cette battle n\'attend plus de reponse.';
  if (message.includes('only_invited_producer_can_respond')) return 'Seul le producteur invite peut repondre.';
  if (message.includes('battle_not_found')) return 'Battle introuvable.';
  return 'Action impossible pour le moment.';
}

function toStatusLabel(status: BattleStatus) {
  if (status === 'pending_acceptance') return 'En attente de reponse';
  if (status === 'awaiting_admin') return 'En attente validation admin';
  if (status === 'rejected') return 'Refusee';
  if (status === 'active') return 'Active';
  if (status === 'voting') return 'Voting (legacy)';
  if (status === 'completed') return 'Terminee';
  if (status === 'cancelled') return 'Annulee';
  if (status === 'approved') return 'Approuvee';
  return 'Pending';
}

export function ProducerBattlesPage() {
  const { profile } = useAuth();

  const [producers, setProducers] = useState<ProducerOption[]>([]);
  const [myProducts, setMyProducts] = useState<ProductOption[]>([]);
  const [producer2Products, setProducer2Products] = useState<ProductOption[]>([]);
  const [battles, setBattles] = useState<ManagedBattle[]>([]);
  const [incomingBattles, setIncomingBattles] = useState<IncomingBattle[]>([]);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    producer2Id: '',
    product1Id: '',
    product2Id: '',
  });

  const producerOptions = useMemo(
    () => [
      { value: '', label: 'Choisir un producteur' },
      ...producers.map((p) => ({ value: p.id, label: p.username || p.id })),
    ],
    [producers]
  );

  const product1Options = useMemo(
    () => [
      { value: '', label: 'Choisir un produit' },
      ...myProducts.map((p) => ({ value: p.id, label: p.title })),
    ],
    [myProducts]
  );

  const product2Options = useMemo(
    () => [
      { value: '', label: 'Choisir un produit' },
      ...producer2Products.map((p) => ({ value: p.id, label: p.title })),
    ],
    [producer2Products]
  );

  const loadBattles = useCallback(async () => {
    if (!profile?.id) return;

    const [createdRes, incomingRes] = await Promise.all([
      supabase
        .from('battles')
        .select(`
          id,
          title,
          slug,
          status,
          rejection_reason,
          accepted_at,
          admin_validated_at,
          voting_ends_at,
          votes_producer1,
          votes_producer2,
          producer2:user_profiles!battles_producer2_id_fkey(username),
          product1:products!battles_product1_id_fkey(title),
          product2:products!battles_product2_id_fkey(title)
        `)
        .eq('producer1_id', profile.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('battles')
        .select(`
          id,
          title,
          slug,
          status,
          response_deadline,
          producer1:user_profiles!battles_producer1_id_fkey(username),
          product1:products!battles_product1_id_fkey(title),
          product2:products!battles_product2_id_fkey(title)
        `)
        .eq('producer2_id', profile.id)
        .eq('status', 'pending_acceptance')
        .order('created_at', { ascending: false }),
    ]);

    if (createdRes.error) {
      console.error('Error fetching producer battles:', createdRes.error);
      setError('Impossible de charger vos battles.');
      setBattles([]);
    } else {
      setBattles((createdRes.data as ManagedBattle[] | null) ?? []);
    }

    if (incomingRes.error) {
      console.error('Error fetching incoming battle responses:', incomingRes.error);
      setIncomingBattles([]);
      if (!createdRes.error) {
        setError('Impossible de charger les battles en attente de reponse.');
      }
    } else {
      setIncomingBattles((incomingRes.data as IncomingBattle[] | null) ?? []);
    }
  }, [profile?.id]);

  useEffect(() => {
    let isCancelled = false;

    async function loadInitial() {
      if (!profile?.id) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const [producersRes, productsRes] = await Promise.all([
        supabase
          .from('user_profiles')
          .select('id, username')
          .eq('is_producer_active', true)
          .neq('id', profile.id)
          .order('username', { ascending: true }),
        supabase
          .from('products')
          .select('id, title')
          .eq('producer_id', profile.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      ]);

      if (!isCancelled) {
        if (producersRes.error) {
          console.error('Error loading producers for battle creation:', producersRes.error);
        }
        if (productsRes.error) {
          console.error('Error loading producer products:', productsRes.error);
        }

        setProducers((producersRes.data as ProducerOption[] | null) ?? []);
        setMyProducts((productsRes.data as ProductOption[] | null) ?? []);

        await loadBattles();
        setIsLoading(false);
      }
    }

    void loadInitial();

    return () => {
      isCancelled = true;
    };
  }, [loadBattles, profile?.id]);

  useEffect(() => {
    let isCancelled = false;

    async function loadProducer2Products() {
      if (!form.producer2Id) {
        setProducer2Products([]);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('products')
        .select('id, title')
        .eq('producer_id', form.producer2Id)
        .eq('is_published', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (!isCancelled) {
        if (fetchError) {
          console.error('Error loading producer2 products:', fetchError);
          setProducer2Products([]);
        } else {
          setProducer2Products((data as ProductOption[] | null) ?? []);
        }
      }
    }

    void loadProducer2Products();

    return () => {
      isCancelled = true;
    };
  }, [form.producer2Id]);

  const createBattle = async () => {
    if (!profile?.id) return;

    if (!form.title.trim()) {
      setError('Le titre est requis.');
      return;
    }

    if (!form.producer2Id) {
      setError('Le producteur invite est requis.');
      return;
    }

    setError(null);
    setIsSaving(true);

    const { error: insertError } = await supabase
      .from('battles')
      .insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        producer1_id: profile.id,
        producer2_id: form.producer2Id,
        product1_id: form.product1Id || null,
        product2_id: form.product2Id || null,
        status: 'pending_acceptance',
        winner_id: null,
        votes_producer1: 0,
        votes_producer2: 0,
      });

    if (insertError) {
      console.error('Error creating battle:', insertError);
      setError('Creation de la battle impossible. Verifiez les champs renseignes.');
      setIsSaving(false);
      return;
    }

    setForm({
      title: '',
      description: '',
      producer2Id: '',
      product1Id: '',
      product2Id: '',
    });
    setProducer2Products([]);
    setIsSaving(false);
    await loadBattles();
  };

  const respondToBattle = async (battleId: string, accept: boolean) => {
    setError(null);
    setRespondingId(battleId);

    const reason = (rejectReasons[battleId] || '').trim();
    if (!accept && !reason) {
      setRespondingId(null);
      setError('La raison du refus est obligatoire.');
      return;
    }

    const { error: rpcError } = await supabase.rpc('respond_to_battle', {
      p_battle_id: battleId,
      p_accept: accept,
      p_reason: accept ? null : reason,
    });

    if (rpcError) {
      setRespondingId(null);
      setError(toRpcErrorMessage(rpcError.message));
      return;
    }

    setRejectReasons((prev) => ({ ...prev, [battleId]: '' }));
    setRespondingId(null);
    await loadBattles();
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Gestion Battles Producteur</h1>
            <p className="text-zinc-400 mt-1">Creation, acceptation/refus, suivi de validation admin.</p>
          </div>
          <Link to="/battles">
            <Button variant="outline">Voir la liste publique</Button>
          </Link>
        </div>

        {error && (
          <Card className="bg-red-900/20 border border-red-800 text-red-300 inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </Card>
        )}

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white inline-flex items-center gap-2">
            <Swords className="w-4 h-4" />
            Creer une battle (pending_acceptance)
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Titre"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Ex: Clash Boom Bap"
            />

            <Input
              label="Description"
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Description courte"
            />

            <Select
              label="Producteur 2"
              value={form.producer2Id}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  producer2Id: event.target.value,
                  product2Id: '',
                }))
              }
              options={producerOptions}
            />

            <Select
              label="Produit 1 (vous)"
              value={form.product1Id}
              onChange={(event) => setForm((prev) => ({ ...prev, product1Id: event.target.value }))}
              options={product1Options}
            />

            <Select
              label="Produit 2 (adversaire)"
              value={form.product2Id}
              onChange={(event) => setForm((prev) => ({ ...prev, product2Id: event.target.value }))}
              options={product2Options}
              disabled={!form.producer2Id}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={createBattle} isLoading={isSaving}>Creer</Button>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white inline-flex items-center gap-2">
            <MailQuestion className="w-4 h-4" />
            Battles en attente de reponse (vous etes invite)
          </h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : incomingBattles.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucune invitation en attente.</p>
          ) : (
            <ul className="space-y-3">
              {incomingBattles.map((battle) => (
                <li key={battle.id} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/50 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-white font-semibold">{battle.title}</p>
                      <p className="text-zinc-400 text-sm">
                        Invite par {battle.producer1?.username || 'Producteur'}
                      </p>
                      <p className="text-zinc-500 text-xs mt-1">
                        {battle.product1?.title || 'Produit 1 non defini'} vs {battle.product2?.title || 'Produit 2 non defini'}
                      </p>
                    </div>

                    <Badge variant={badgeByStatus[battle.status]}>{toStatusLabel(battle.status)}</Badge>
                  </div>

                  <div className="space-y-2">
                    <Input
                      label="Raison du refus (obligatoire si refus)"
                      value={rejectReasons[battle.id] || ''}
                      onChange={(event) =>
                        setRejectReasons((prev) => ({
                          ...prev,
                          [battle.id]: event.target.value,
                        }))
                      }
                      placeholder="Expliquez brièvement le refus"
                    />
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={respondingId === battle.id}
                        leftIcon={<CheckCircle2 className="w-4 h-4" />}
                        onClick={() => respondToBattle(battle.id, true)}
                      >
                        Accepter
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        isLoading={respondingId === battle.id}
                        leftIcon={<XCircle className="w-4 h-4" />}
                        onClick={() => respondToBattle(battle.id, false)}
                      >
                        Refuser
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Mes battles creees (producer1)</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : battles.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucune battle pour le moment.</p>
          ) : (
            <ul className="space-y-3">
              {battles.map((battle) => (
                <li key={battle.id} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/50 space-y-2">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-white font-semibold">{battle.title}</p>
                      <p className="text-zinc-400 text-sm">
                        {battle.product1?.title || 'Produit 1 manquant'} vs {battle.product2?.title || 'Produit 2 manquant'}
                      </p>
                      <p className="text-zinc-500 text-xs mt-1">
                        Votes: {battle.votes_producer1} - {battle.votes_producer2}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                      <Badge variant={badgeByStatus[battle.status]}>{toStatusLabel(battle.status)}</Badge>
                      <Link to={`/battles/${battle.slug}`}>
                        <Button size="sm" variant="ghost">Ouvrir</Button>
                      </Link>
                    </div>
                  </div>

                  {battle.status === 'rejected' && battle.rejection_reason && (
                    <p className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded px-3 py-2">
                      Motif du refus: {battle.rejection_reason}
                    </p>
                  )}

                  {battle.status === 'awaiting_admin' && (
                    <p className="text-sm text-sky-300 bg-sky-900/20 border border-sky-800 rounded px-3 py-2">
                      Battle acceptee par producer2, en attente de validation admin.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
