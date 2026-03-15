import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { formatRankTier } from '../../components/reputation/ReputationBadge';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime, slugify } from '../../lib/utils/format';
import type { ReputationRankTier } from '../../lib/supabase/types';

type ForumCategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_premium_only: boolean;
  position: number;
  xp_multiplier: number;
  moderation_strictness: 'low' | 'normal' | 'high';
  is_competitive: boolean;
  required_rank_tier: ReputationRankTier | null;
  allow_links: boolean;
  allow_media: boolean;
  created_at: string;
};

const FORUM_CATEGORIES_TABLE = 'forum_categories' as any;

interface CategoryFormState {
  name: string;
  description: string;
  isPremiumOnly: boolean;
  position: string;
  xpMultiplier: string;
  moderationStrictness: 'low' | 'normal' | 'high';
  isCompetitive: boolean;
  requiredRankTier: ReputationRankTier | '';
  allowLinks: boolean;
  allowMedia: boolean;
}

const EMPTY_FORM: CategoryFormState = {
  name: '',
  description: '',
  isPremiumOnly: false,
  position: '',
  xpMultiplier: '1',
  moderationStrictness: 'normal',
  isCompetitive: false,
  requiredRankTier: '',
  allowLinks: true,
  allowMedia: true,
};

export function AdminForumCategoriesPage() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<ForumCategoryRow[]>([]);
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const isSubmitting = actionKey === 'submit';

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr')),
    [categories],
  );

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const loadCategories = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from(FORUM_CATEGORIES_TABLE)
      .select('id, name, slug, description, is_premium_only, position, xp_multiplier, moderation_strictness, is_competitive, required_rank_tier, allow_links, allow_media, created_at')
      .order('position', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('Error loading forum categories', error);
      toast.error(t('admin.forumCategories.loadError'));
      setCategories([]);
      setIsLoading(false);
      return;
    }

    setCategories((data as unknown as ForumCategoryRow[] | null) ?? []);
    setIsLoading(false);
  }, [t]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const name = form.name.trim();
    const description = form.description.trim();
    const slug = slugify(name);
    const position = form.position.trim() ? Number.parseInt(form.position, 10) : null;
    const xpMultiplier = Number.parseFloat(form.xpMultiplier);

    if (!name) {
      toast.error(t('admin.forumCategories.nameRequired'));
      return;
    }

    if (!slug) {
      toast.error(t('admin.forumCategories.slugError'));
      return;
    }

    if (!Number.isFinite(xpMultiplier) || xpMultiplier <= 0) {
      toast.error(t('admin.forumCategories.invalidXpMultiplier'));
      return;
    }

    setActionKey('submit');
    const { data, error } = await supabase.rpc('forum_admin_upsert_category' as any, {
      p_category_id: editingId,
      p_name: name,
      p_slug: slug,
      p_description: description || null,
      p_position: Number.isFinite(position as number) ? position : null,
      p_is_premium_only: form.isPremiumOnly,
      p_xp_multiplier: xpMultiplier,
      p_moderation_strictness: form.moderationStrictness,
      p_is_competitive: form.isCompetitive,
      p_required_rank_tier: form.requiredRankTier || null,
      p_allow_links: form.allowLinks,
      p_allow_media: form.allowMedia,
    });

    if (error) {
      console.error('Error saving forum category', error);
      toast.error(t('admin.forumCategories.saveError'));
      setActionKey(null);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      const nextRow = row as ForumCategoryRow;
      setCategories((prev) => {
        const hasExisting = prev.some((category) => category.id === nextRow.id);
        return hasExisting
          ? prev.map((category) => (category.id === nextRow.id ? nextRow : category))
          : [...prev, nextRow];
      });
    }

    toast.success(editingId ? t('admin.forumCategories.updated') : t('admin.forumCategories.created'));
    resetForm();
    setActionKey(null);
  };

  const startEdit = (category: ForumCategoryRow) => {
    setEditingId(category.id);
    setForm({
      name: category.name,
      description: category.description ?? '',
      isPremiumOnly: category.is_premium_only,
      position: String(category.position),
      xpMultiplier: String(category.xp_multiplier ?? 1),
      moderationStrictness: category.moderation_strictness ?? 'normal',
      isCompetitive: category.is_competitive,
      requiredRankTier: category.required_rank_tier ?? '',
      allowLinks: category.allow_links,
      allowMedia: category.allow_media,
    });
  };

  const deleteCategory = async (categoryId: string) => {
    setActionKey(`delete:${categoryId}`);
    const { error } = await supabase.rpc('forum_admin_delete_category' as any, {
      p_category_id: categoryId,
    });

    if (error) {
      console.error('Error deleting forum category', error);
      toast.error(
        error.message.includes('category_has_topics')
          ? t('admin.forumCategories.deleteBlocked')
          : t('admin.forumCategories.deleteError')
      );
      setActionKey(null);
      return;
    }

    setCategories((prev) => prev.filter((category) => category.id !== categoryId));
    if (editingId === categoryId) {
      resetForm();
    }
    toast.success(t('admin.forumCategories.deleted'));
    setActionKey(null);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">{t('admin.forumCategories.title')}</h2>
            <p className="text-zinc-400 text-sm mt-1">
              {t('admin.forumCategories.subtitle')}
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadCategories()}>
            {t('common.refresh')}
          </Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="text-lg font-semibold text-white mb-4">
          {editingId ? t('admin.forumCategories.editTitle') : t('admin.forumCategories.newTitle')}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={t('common.name')}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={t('admin.forumCategories.namePlaceholder')}
              disabled={isSubmitting}
            />
            <Input
              label={t('admin.forumCategories.positionLabel')}
              type="number"
              value={form.position}
              onChange={(event) => setForm((prev) => ({ ...prev, position: event.target.value }))}
              placeholder="0"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="forum-category-description">
              {t('common.description')}
            </label>
            <textarea
              id="forum-category-description"
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder={t('admin.forumCategories.descriptionPlaceholder')}
              disabled={isSubmitting}
              rows={4}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Input
              label={t('admin.forumCategories.xpMultiplierLabel')}
              type="number"
              step="0.1"
              min="0.1"
              value={form.xpMultiplier}
              onChange={(event) => setForm((prev) => ({ ...prev, xpMultiplier: event.target.value }))}
              disabled={isSubmitting}
            />
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="forum-category-strictness">
                {t('admin.forumCategories.moderationLabel')}
              </label>
              <select
                id="forum-category-strictness"
                value={form.moderationStrictness}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, moderationStrictness: event.target.value as CategoryFormState['moderationStrictness'] }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-white focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              >
                <option value="low">{t('myMessages.priorityLow')}</option>
                <option value="normal">{t('myMessages.priorityNormal')}</option>
                <option value="high">{t('myMessages.priorityHigh')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="forum-category-rank">
                {t('admin.forumCategories.requiredRankLabel')}
              </label>
              <select
                id="forum-category-rank"
                value={form.requiredRankTier}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, requiredRankTier: event.target.value as CategoryFormState['requiredRankTier'] }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-white focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              >
                <option value="">{t('common.none')}</option>
                <option value="bronze">{formatRankTier('bronze', t)}</option>
                <option value="silver">{formatRankTier('silver', t)}</option>
                <option value="gold">{formatRankTier('gold', t)}</option>
                <option value="platinum">{formatRankTier('platinum', t)}</option>
                <option value="diamond">{formatRankTier('diamond', t)}</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {[
              ['isPremiumOnly', t('admin.forumCategories.premiumLabel')],
              ['isCompetitive', t('admin.forumCategories.competitiveLabel')],
              ['allowLinks', t('admin.forumCategories.allowLinksLabel')],
              ['allowMedia', t('admin.forumCategories.allowMediaLabel')],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form[key as keyof CategoryFormState] as boolean}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, [key]: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" isLoading={isSubmitting}>
              {editingId ? t('common.save') : t('admin.forumCategories.createAction')}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={isSubmitting}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="text-lg font-semibold text-white mb-4">{t('admin.forumCategories.existingTitle')}</h3>
        {isLoading ? (
          <p className="text-zinc-400">{t('common.loading')}</p>
        ) : sortedCategories.length === 0 ? (
          <p className="text-zinc-500">{t('admin.forumCategories.empty')}</p>
        ) : (
          <div className="space-y-3">
            {sortedCategories.map((category) => (
              <div key={category.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-zinc-500">
                      {t('admin.forumCategories.summaryLine', {
                        slug: category.slug,
                        position: category.position,
                        date: formatDateTime(category.created_at),
                      })}
                    </p>
                    <h4 className="text-white font-medium">{category.name}</h4>
                    {category.description && (
                      <p className="text-sm text-zinc-300 whitespace-pre-wrap">{category.description}</p>
                    )}
                    <p className="text-xs text-zinc-500">
                      {t('admin.forumCategories.rulesLine', {
                        xp: category.xp_multiplier,
                        moderation:
                          category.moderation_strictness === 'low'
                            ? t('myMessages.priorityLow')
                            : category.moderation_strictness === 'high'
                              ? t('myMessages.priorityHigh')
                              : t('myMessages.priorityNormal'),
                        mode: category.is_competitive
                          ? t('forum.competitive')
                          : t('admin.forumCategories.standardMode'),
                        rank: category.required_rank_tier
                          ? formatRankTier(category.required_rank_tier, t)
                          : t('admin.forumCategories.openRank'),
                      })}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t('admin.forumCategories.flagsLine', {
                        access: category.is_premium_only
                          ? t('forum.premium')
                          : t('admin.forumCategories.accessible'),
                        links: category.allow_links
                          ? t('admin.forumCategories.linksOn')
                          : t('admin.forumCategories.linksOff'),
                        media: category.allow_media
                          ? t('admin.forumCategories.mediaOn')
                          : t('admin.forumCategories.mediaOff'),
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(category)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      isLoading={actionKey === `delete:${category.id}`}
                      onClick={() => void deleteCategory(category.id)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
