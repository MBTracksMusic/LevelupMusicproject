import { useMemo, useState, type FormEvent } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useTranslation } from '../../lib/i18n';

export interface NewsFormValues {
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  is_published: boolean;
  broadcast_email: boolean;
}

interface NewsFormProps {
  mode: 'create' | 'edit';
  initialValues?: Partial<NewsFormValues>;
  isSubmitting?: boolean;
  onSubmit: (values: NewsFormValues) => Promise<void> | void;
  onCancel: () => void;
}

const YOUTUBE_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)[A-Za-z0-9_-]{6,}/i;
const VIMEO_REGEX = /^(https?:\/\/)?(www\.)?vimeo\.com\/\d+/i;
const MP4_REGEX = /^https:\/\/.+\.mp4(\?.*)?$/i;

export function isSupportedVideoUrl(url: string) {
  const clean = url.trim();
  if (!clean) return false;
  return YOUTUBE_REGEX.test(clean) || VIMEO_REGEX.test(clean) || MP4_REGEX.test(clean);
}

export function NewsForm({
  mode,
  initialValues,
  isSubmitting = false,
  onSubmit,
  onCancel,
}: NewsFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<NewsFormValues>({
    title: initialValues?.title ?? '',
    description: initialValues?.description ?? '',
    video_url: initialValues?.video_url ?? '',
    thumbnail_url: initialValues?.thumbnail_url ?? '',
    is_published: initialValues?.is_published ?? false,
    broadcast_email: initialValues?.broadcast_email ?? false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof NewsFormValues, string>>>({});

  const submitLabel = useMemo(
    () => (mode === 'create' ? t('admin.news.form.createSubmit') : t('common.save')),
    [mode, t],
  );

  const setField = <K extends keyof NewsFormValues>(key: K, value: NewsFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = () => {
    const nextErrors: Partial<Record<keyof NewsFormValues, string>> = {};

    if (!form.title.trim()) {
      nextErrors.title = t('admin.news.form.titleRequired');
    }

    if (!form.video_url.trim()) {
      nextErrors.video_url = t('admin.news.form.videoUrlRequired');
    } else if (!isSupportedVideoUrl(form.video_url)) {
      nextErrors.video_url = t('admin.news.form.videoUrlInvalid');
    }

    if (form.thumbnail_url.trim()) {
      try {
        const parsed = new URL(form.thumbnail_url.trim());
        if (!(parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
          nextErrors.thumbnail_url = t('admin.news.form.thumbnailInvalid');
        }
      } catch {
        nextErrors.thumbnail_url = t('admin.news.form.thumbnailInvalid');
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    await onSubmit({
      title: form.title.trim(),
      description: form.description.trim(),
      video_url: form.video_url.trim(),
      thumbnail_url: form.thumbnail_url.trim(),
      is_published: form.is_published,
      broadcast_email: form.broadcast_email,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label={t('admin.news.form.titleLabel')}
        value={form.title}
        onChange={(event) => setField('title', event.target.value)}
        placeholder={t('admin.news.form.titlePlaceholder')}
        error={errors.title}
        required
      />

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="news-description">
          {t('common.description')}
        </label>
        <textarea
          id="news-description"
          className="w-full min-h-[110px] bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
          value={form.description}
          onChange={(event) => setField('description', event.target.value)}
          placeholder={t('admin.news.form.descriptionPlaceholder')}
        />
      </div>

      <Input
        label={t('admin.news.form.videoUrlLabel')}
        value={form.video_url}
        onChange={(event) => setField('video_url', event.target.value)}
        placeholder={t('admin.news.form.videoUrlPlaceholder')}
        error={errors.video_url}
        required
      />

      <Input
        label={t('admin.news.form.thumbnailLabel')}
        value={form.thumbnail_url}
        onChange={(event) => setField('thumbnail_url', event.target.value)}
        placeholder={t('admin.news.form.thumbnailPlaceholder')}
        error={errors.thumbnail_url}
      />

      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
        <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-rose-500 focus:ring-rose-500/50"
            checked={form.is_published}
            onChange={(event) => setField('is_published', event.target.checked)}
          />
          <span>{t('producer.published')}</span>
        </label>

        <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-rose-500 focus:ring-rose-500/50"
            checked={form.broadcast_email}
            onChange={(event) => setField('broadcast_email', event.target.checked)}
          />
          <span>{t('admin.news.form.broadcastLabel')}</span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
