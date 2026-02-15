import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud,
  Music,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { slugify } from '../lib/utils/format';
import { normalizeStoragePath } from '../lib/utils/storage';

type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';

type ErrorState = Partial<Record<'audio' | 'image' | 'form', string>>;

const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_AUDIO_DURATION = 10 * 60; // 10 minutes in seconds
const MIN_IMAGE_DIMENSION = 500; // px

const AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'beats-audio';
const WATERMARKED_BUCKET = import.meta.env.VITE_SUPABASE_WATERMARKED_BUCKET || 'beats-watermarked';
const COVER_BUCKET = import.meta.env.VITE_SUPABASE_COVER_BUCKET || 'beats-covers';
const AUDIO_BUCKET_CANDIDATES = [
  AUDIO_BUCKET,
  WATERMARKED_BUCKET,
  'beats-audio',
  'beats-watermarked',
].filter((value, index, source) => Boolean(value) && source.indexOf(value) === index);

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown; error?: unknown }).message
      ?? (error as { message?: unknown; error?: unknown }).error;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return fallback;
};

const isBucketFallbackCandidateError = (error: unknown) => {
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    (message.includes('bucket') && message.includes('not found')) ||
    message.includes('row-level security') ||
    message.includes('permission denied') ||
    message.includes('not authorized')
  );
};

const isProductSchemaMismatchError = (error: unknown) => {
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    (message.includes('master_url') || message.includes('master_path') || message.includes('watermarked_path')) &&
    (message.includes('column') || message.includes('schema cache') || message.includes('does not exist'))
  );
};

// Page d'upload minimaliste pour les producteurs actifs.
export function UploadBeatPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState({ audio: 0, image: 0 });
  const [uploadStatus, setUploadStatus] = useState<{ audio: UploadPhase; image: UploadPhase }>({
    audio: 'idle',
    image: 'idle',
  });
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<ErrorState>({});
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [bpm, setBpm] = useState('');
  const [keySignature, setKeySignature] = useState('');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    };
  }, [audioPreviewUrl]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const isProducerActive = profile?.is_producer_active ?? false;
  const hasValidationErrors = !!errors.audio || !!errors.image;
  const isPublishDisabled =
    !audioFile ||
    !title.trim() ||
    !price ||
    hasValidationErrors ||
    isUploading ||
    !isProducerActive;

  const resetAudio = () => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioFile(null);
    setAudioPreviewUrl(null);
    setAudioDuration(0);
    setUploadProgress((prev) => ({ ...prev, audio: 0 }));
    setUploadStatus((prev) => ({ ...prev, audio: 'idle' }));
  };

  const resetImage = () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImagePreviewUrl(null);
    setUploadProgress((prev) => ({ ...prev, image: 0 }));
    setUploadStatus((prev) => ({ ...prev, image: 'idle' }));
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 o';
    const sizes = ['o', 'Ko', 'Mo', 'Go'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
    const value = bytes / 1024 ** i;
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getAudioDuration = (src: string) =>
    new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = src;
      audio.onloadedmetadata = () => resolve(audio.duration || 0);
      audio.onerror = () => reject(new Error('Impossible de lire ce fichier audio.'));
    });

  const getImageDimensions = (src: string) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => reject(new Error('Impossible de lire cette image.'));
      img.src = src;
    });

  const handleAudioChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    resetAudio();

    const allowedTypes = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3'];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({ ...prev, audio: 'Formats autorisés : WAV ou MP3' }));
      return;
    }

    if (file.size > MAX_AUDIO_SIZE) {
      setErrors((prev) => ({ ...prev, audio: 'Poids maxi : 50 Mo' }));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    try {
      const duration = await getAudioDuration(previewUrl);
      if (duration > MAX_AUDIO_DURATION) {
        throw new Error('Durée maximale : 10 minutes');
      }

      setAudioFile(file);
      setAudioPreviewUrl(previewUrl);
      setAudioDuration(duration);
      setErrors((prev) => ({ ...prev, audio: undefined }));
      setUploadStatus((prev) => ({ ...prev, audio: 'idle' }));
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setErrors((prev) => ({
        ...prev,
        audio: error instanceof Error ? error.message : 'Fichier audio invalide',
      }));
    }
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    resetImage();

    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({ ...prev, image: 'Formats autorisés : JPG ou PNG' }));
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setErrors((prev) => ({ ...prev, image: 'Poids maxi : 5 Mo' }));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    try {
      const { width, height } = await getImageDimensions(previewUrl);
      if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
        throw new Error('Dimensions minimales : 500x500 px');
      }

      setImageFile(file);
      setImagePreviewUrl(previewUrl);
      setErrors((prev) => ({ ...prev, image: undefined }));
      setUploadStatus((prev) => ({ ...prev, image: 'idle' }));
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setErrors((prev) => ({
        ...prev,
        image: error instanceof Error ? error.message : 'Image invalide',
      }));
    }
  };

  const renderStatusBadge = (type: 'audio' | 'image') => {
    const file = type === 'audio' ? audioFile : imageFile;
    const error = type === 'audio' ? errors.audio : errors.image;
    const status = uploadStatus[type];

    if (!file) {
      return (
        <Badge variant="default" size="sm" className="text-xs">
          {t('producer.fileMissing')}
        </Badge>
      );
    }

    if (error) {
      return (
        <Badge variant="danger" size="sm" className="text-xs">
          <XCircle className="w-3.5 h-3.5" />
          {t('producer.fileError')}
        </Badge>
      );
    }

    if (status === 'uploading') {
      return (
        <Badge variant="warning" size="sm" className="text-xs">
          {t('producer.uploading')}
        </Badge>
      );
    }

    if (status === 'success') {
      return (
        <Badge variant="success" size="sm" className="text-xs">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {t('producer.fileReady')}
        </Badge>
      );
    }

    return (
      <Badge variant="success" size="sm" className="text-xs">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {t('producer.fileReady')}
      </Badge>
    );
  };

  const uploadToSupabase = async () => {
    if (!audioFile) {
      setErrors((prev) => ({ ...prev, form: t('producer.audioRequired') }));
      return;
    }

    const trimmedTitle = title.trim();
    const priceValue = parseFloat(price);

    if (!trimmedTitle) {
      setErrors((prev) => ({ ...prev, form: t('producer.productTitle') }));
      return;
    }

    if (Number.isNaN(priceValue) || priceValue < 0) {
      setErrors((prev) => ({ ...prev, form: t('products.price') }));
      return;
    }

    if (hasValidationErrors) return;
    if (!isProducerActive) {
      setErrors((prev) => ({ ...prev, form: t('producer.subscriptionRequired') }));
      return;
    }

    setIsUploading(true);
    setErrors((prev) => ({ ...prev, form: undefined }));
    setUploadStatus({
      audio: audioFile ? 'uploading' : 'idle',
      image: imageFile ? 'uploading' : 'idle',
    });
    setUploadProgress({ audio: 0, image: 0 });

    const timestamp = Date.now();
    const slug = `${slugify(trimmedTitle)}-${timestamp}`;
    const priceCents = Math.round(priceValue * 100);
    let audioPath = '';
    let audioBucketUsed = AUDIO_BUCKET;
    let coverPath = '';

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const producerId = authData.user?.id ?? profile?.id ?? null;
      if (authError || !producerId) {
        throw new Error('Session expirée. Reconnectez-vous puis réessayez.');
      }

      audioPath = `${producerId}/audio/${timestamp}-${audioFile.name.replace(/\s+/g, '-')}`;
      setUploadProgress((prev) => ({ ...prev, audio: 15 }));
      let audioStoragePath: string | null = null;
      let lastAudioError: unknown = null;

      for (const candidateBucket of AUDIO_BUCKET_CANDIDATES) {
        const { data: audioData, error: audioError } = await supabase.storage
          .from(candidateBucket)
          .upload(audioPath, audioFile, {
            cacheControl: '3600',
            upsert: false,
          });

        if (!audioError) {
          audioBucketUsed = candidateBucket;
          audioStoragePath = normalizeStoragePath(audioData?.path || audioPath, candidateBucket);
          break;
        }

        lastAudioError = audioError;
        if (!isBucketFallbackCandidateError(audioError)) {
          break;
        }
      }

      if (!audioStoragePath) {
        throw lastAudioError ?? new Error('Echec upload audio');
      }

      setUploadStatus((prev) => ({ ...prev, audio: 'success' }));
      setUploadProgress((prev) => ({ ...prev, audio: 100 }));

      if (imageFile) {
        coverPath = `${producerId}/cover/${timestamp}-${imageFile.name.replace(/\s+/g, '-')}`;
        setUploadProgress((prev) => ({ ...prev, image: 15 }));
        const { error: imageError } = await supabase.storage.from(COVER_BUCKET).upload(coverPath, imageFile, {
          cacheControl: '3600',
          upsert: false,
        });

        if (imageError) {
          throw imageError;
        }

        setUploadStatus((prev) => ({ ...prev, image: 'success' }));
        setUploadProgress((prev) => ({ ...prev, image: 100 }));
      }
      const coverPublicUrl = coverPath
        ? supabase.storage.from(COVER_BUCKET).getPublicUrl(coverPath).data?.publicUrl
        : null;

      const basePayload = {
        producer_id: producerId,
        title: trimmedTitle,
        slug,
        description: description.trim() || null,
        product_type: 'beat',
        price: priceCents,
        bpm: bpm ? parseInt(bpm) : null,
        key_signature: keySignature || null,
        cover_image_url: coverPublicUrl,
        is_published: true,
        duration_seconds: Math.round(audioDuration) || null,
        file_format: audioFile.type || 'audio/mpeg',
      };

      const legacyPayload = {
        ...basePayload,
        preview_url: audioStoragePath,
        master_url: audioStoragePath,
      };

      const modernPayload = {
        ...basePayload,
        preview_url: audioStoragePath,
        watermarked_path: audioStoragePath,
        master_path: audioStoragePath,
      };

      const payloads = audioBucketUsed === 'beats-watermarked'
        ? [modernPayload, legacyPayload]
        : [legacyPayload, modernPayload];

      let productError: unknown = null;
      for (const payload of payloads) {
        const { error } = await supabase.from('products').insert(payload);
        if (!error) {
          productError = null;
          break;
        }

        productError = error;
        if (!isProductSchemaMismatchError(error)) {
          break;
        }
      }

      if (productError) {
        throw productError;
      }

      toast.success('Beat publié avec succès !');
      setErrors({});
      setTitle('');
      setPrice('');
      setDescription('');
      setBpm('');
      setKeySignature('');
      resetAudio();
      resetImage();
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Upload impossible pour le moment.');
      console.error('[upload-beat] upload failed', error);
      setUploadStatus((prev) => ({ ...prev, audio: 'error', image: imageFile ? 'error' : prev.image }));
      setErrors((prev) => ({
        ...prev,
        form: errorMessage,
      }));
      toast.error(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const renderProgressBar = (label: string, progress: number, status: UploadPhase) => {
    const color =
      status === 'success'
        ? 'bg-emerald-500'
        : status === 'error'
          ? 'bg-red-500'
          : 'bg-rose-500';
    const statusLabel =
      status === 'success'
        ? t('producer.fileReady')
        : status === 'error'
          ? t('producer.fileError')
          : t('producer.uploading');

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>{label}</span>
          <span className={status === 'error' ? 'text-red-400' : 'text-zinc-300'}>
            {statusLabel} • {progress}%
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full ${color} transition-all duration-200`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white pt-24 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-rose-500/10 text-rose-300">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm uppercase tracking-wide text-rose-400">
              {t('producer.uploadBeat')}
            </p>
            <h1 className="text-3xl font-bold mt-1">
              {profile?.username || profile?.email}
            </h1>
            <p className="text-zinc-400 mt-1">
              {t('producer.subscriptionRequired')}
            </p>
          </div>
        </header>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('producer.productTitle')}
              placeholder="Ex: Midnight Bounce"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUploading}
            />
            <Input
              label={t('products.price')}
              type="number"
              placeholder="Prix (€)"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              {t('producer.productDescription')}
            </label>
            <textarea
              rows={4}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
              placeholder="Décris l'ambiance, les instruments, les licences..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="BPM"
              type="number"
              placeholder="Ex: 140"
              min="0"
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              disabled={isUploading}
            />
            <Input
              label={t('products.key')}
              placeholder="Ex: Am"
              value={keySignature}
              onChange={(e) => setKeySignature(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-rose-500/10 text-rose-300">
                    <Music className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {t('producer.uploadAudio')}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t('producer.audioRequirements')}
                    </p>
                  </div>
                </div>
                {renderStatusBadge('audio')}
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/wav,audio/mp3,audio/mpeg"
                  className="hidden"
                  onChange={handleAudioChange}
                  disabled={isUploading}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={isUploading}
                  leftIcon={<UploadCloud className="w-4 h-4" />}
                >
                  {t('producer.chooseAudioFile')}
                </Button>
                {audioFile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => audioInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {t('producer.replaceFile')}
                  </Button>
                )}
              </div>

              {audioFile ? (
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 space-y-2 transition-all duration-200">
                  <div className="flex items-center justify-between text-sm text-zinc-200">
                    <span className="truncate">{audioFile.name}</span>
                    <span className="text-xs text-zinc-500">{formatBytes(audioFile.size)}</span>
                  </div>
                  {audioPreviewUrl && (
                    <audio controls src={audioPreviewUrl} className="w-full rounded-md" />
                  )}
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>
                      {t('producer.duration')}: {formatDuration(audioDuration)}
                    </span>
                    {!errors.audio && <span className="text-emerald-400">{t('producer.fileReady')}</span>}
                  </div>
                  {isUploading &&
                    renderProgressBar(t('producer.uploadAudio'), uploadProgress.audio, uploadStatus.audio)}
                  {errors.audio && (
                    <p className="text-sm text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.audio}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  {t('producer.fileMissing')} – {t('producer.audioRequirements')}
                </p>
              )}
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-300">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {t('producer.uploadCover')}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t('producer.coverRequirements')}
                    </p>
                  </div>
                </div>
                {renderStatusBadge('image')}
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={handleImageChange}
                  disabled={isUploading}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isUploading}
                  leftIcon={<UploadCloud className="w-4 h-4" />}
                >
                  {t('producer.chooseCoverFile')}
                </Button>
                {imageFile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {t('producer.replaceFile')}
                  </Button>
                )}
              </div>

              {imageFile ? (
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 space-y-2 transition-all duration-200">
                  <div className="flex items-center justify-between text-sm text-zinc-200">
                    <span className="truncate">{imageFile.name}</span>
                    <span className="text-xs text-zinc-500">{formatBytes(imageFile.size)}</span>
                  </div>
                  {imagePreviewUrl && (
                    <div className="overflow-hidden rounded-lg border border-zinc-800">
                      <img
                        src={imagePreviewUrl}
                        alt="Prévisualisation pochette"
                        className="w-full aspect-square object-cover"
                      />
                    </div>
                  )}
                  {isUploading &&
                    renderProgressBar(t('producer.uploadCover'), uploadProgress.image, uploadStatus.image)}
                  {errors.image && (
                    <p className="text-sm text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.image}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  {t('producer.fileMissing')} – {t('producer.coverRequirements')}
                </p>
              )}
            </div>
          </div>

          {errors.form && (
            <div className="flex items-start gap-2 rounded-lg border border-red-800/60 bg-red-900/10 px-3 py-2 text-sm text-red-200">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              {!isProducerActive && (
                <>
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span>{t('producer.subscriptionRequired')}</span>
                </>
              )}
              {!audioFile && isProducerActive && (
                <span className="text-amber-300">{t('producer.audioRequired')}</span>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => navigate(-1)} disabled={isUploading}>
                {t('common.cancel')}
              </Button>
              <Button
                leftIcon={<UploadCloud className="w-4 h-4" />}
                onClick={uploadToSupabase}
                isLoading={isUploading}
                disabled={isPublishDisabled}
              >
                {t('producer.publish')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UploadBeatPage;
