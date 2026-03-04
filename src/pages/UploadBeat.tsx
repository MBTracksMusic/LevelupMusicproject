import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { useTranslation, type TranslateFn } from '../lib/i18n';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';
import type { Database } from '../lib/supabase/types';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { slugify } from '../lib/utils/format';
import { normalizeStoragePath } from '../lib/utils/storage';

type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';

type ErrorState = Partial<Record<'audio' | 'image' | 'form', string>>;

interface VersionSourceRow {
  id: string;
  parent_product_id: string | null;
  version_number: number;
  title: string;
  description: string | null;
  price: number;
  bpm: number | null;
  key_signature: string | null;
  cover_image_url: string | null;
  genre_id: string | null;
  mood_id: string | null;
  tags: string[] | null;
  duration_seconds: number | null;
  file_format: string | null;
  license_terms: Database['public']['Tables']['products']['Row']['license_terms'];
  is_exclusive: boolean;
  watermarked_bucket: string | null;
}

interface EditProductRow {
  id: string;
  title: string;
  description: string | null;
  price: number;
  bpm: number | null;
  key_signature: string | null;
  cover_image_url: string | null;
  is_published: boolean;
  file_format: string | null;
}

interface EditPermissions {
  can_edit_audio: boolean;
  can_edit_metadata: boolean;
  can_edit_metadata_essentials?: boolean;
  must_create_new_version: boolean;
  has_sales?: boolean;
  has_active_battle?: boolean;
  has_terminated_battle?: boolean;
}

const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_AUDIO_DURATION = 10 * 60; // 10 minutes in seconds
const MIN_IMAGE_DIMENSION = 500; // px

const MASTER_BUCKET = import.meta.env.VITE_SUPABASE_MASTER_BUCKET || 'beats-masters';
const COVER_BUCKET = import.meta.env.VITE_SUPABASE_COVER_BUCKET || 'beats-covers';

const revokeObjectUrl = (value: string | null) => {
  if (value?.startsWith('blob:')) {
    URL.revokeObjectURL(value);
  }
};

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

const getEditLockMessage = (
  permissions: EditPermissions | null | undefined,
  t: TranslateFn,
) => {
  if (!permissions) {
    return t('uploadBeat.editUnavailable');
  }

  if (permissions.must_create_new_version) {
    if (permissions.has_terminated_battle) {
      return t('uploadBeat.lockCompletedBattle');
    }

    if (permissions.has_sales) {
      return t('uploadBeat.lockHasSales');
    }
  }

  if (permissions.can_edit_audio === false && permissions.has_active_battle) {
    return t('uploadBeat.audioLockedActiveBattle');
  }

  if (permissions.can_edit_audio === false && permissions.has_terminated_battle) {
    return t('uploadBeat.audioLockedCompletedBattle');
  }

  if (permissions.can_edit_metadata === false && permissions.has_terminated_battle) {
    return t('uploadBeat.metadataLockedCompletedBattle');
  }

  return t('uploadBeat.editUnavailable');
};

const getEditModeDescription = (
  permissions: EditPermissions | null | undefined,
  t: TranslateFn,
) => {
  if (!permissions) {
    return t('uploadBeat.checkingPermissions');
  }

  if (permissions.must_create_new_version) {
    return getEditLockMessage(permissions, t);
  }

  if (permissions.can_edit_audio === false && permissions.has_active_battle) {
    return t('uploadBeat.partialEditActiveBattle');
  }

  if (permissions.can_edit_audio === false) {
    return getEditLockMessage(permissions, t);
  }

  return t('uploadBeat.fullEditAllowed');
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
  const [searchParams] = useSearchParams();
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
  const [isWatermarkProcessing, setIsWatermarkProcessing] = useState(false);
  const [versionSource, setVersionSource] = useState<VersionSourceRow | null>(null);
  const [isVersionSourceLoading, setIsVersionSourceLoading] = useState(false);
  const [editingProduct, setEditingProduct] = useState<EditProductRow | null>(null);
  const [editPermissions, setEditPermissions] = useState<EditPermissions | null>(null);
  const [isEditProductLoading, setIsEditProductLoading] = useState(false);

  const cloneFrom = searchParams.get('cloneFrom');
  const editProductId = searchParams.get('editProductId');
  const isEditMode = typeof editProductId === 'string' && editProductId.length > 0;
  const isVersionMode = !isEditMode && typeof cloneFrom === 'string' && cloneFrom.length > 0;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    return () => {
      revokeObjectUrl(audioPreviewUrl);
    };
  }, [audioPreviewUrl]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    let isCancelled = false;

    const loadVersionSource = async () => {
      if (!cloneFrom || !profile?.id) {
        if (!isCancelled) {
          setVersionSource(null);
          setIsVersionSourceLoading(false);
        }
        return;
      }

      setIsVersionSourceLoading(true);
      try {
        const { data, error } = await supabase
          .from('products')
          .select(
            'id, parent_product_id, version_number, title, description, price, bpm, key_signature, cover_image_url, genre_id, mood_id, tags, duration_seconds, file_format, license_terms, is_exclusive, watermarked_bucket'
          )
          .eq('id', cloneFrom)
          .eq('producer_id', profile.id)
          .maybeSingle();

        if (error) {
          throw error;
        }

        const sourceRow = (data as VersionSourceRow | null) ?? null;
        if (!sourceRow) {
          throw new Error(t('uploadBeat.versionSourceNotFound'));
        }

        if (!isCancelled) {
          setVersionSource(sourceRow);
          setTitle(sourceRow.title);
          setPrice((sourceRow.price / 100).toString());
          setDescription(sourceRow.description ?? '');
          setBpm(sourceRow.bpm ? String(sourceRow.bpm) : '');
          setKeySignature(sourceRow.key_signature ?? '');
          setImagePreviewUrl(sourceRow.cover_image_url);
          setErrors((prev) => ({ ...prev, form: undefined }));
        }
      } catch (error) {
        console.error('[upload-beat] failed to load version source', error);
        if (!isCancelled) {
          setErrors((prev) => ({
            ...prev,
            form: getErrorMessage(error, t('uploadBeat.loadVersionSourceError')),
          }));
          setVersionSource(null);
        }
      } finally {
        if (!isCancelled) {
          setIsVersionSourceLoading(false);
        }
      }
    };

    void loadVersionSource();

    return () => {
      isCancelled = true;
    };
  }, [cloneFrom, profile?.id, t]);

  useEffect(() => {
    let isCancelled = false;

    const loadEditProduct = async () => {
      if (!editProductId || !profile?.id) {
        if (!isCancelled) {
          setEditingProduct(null);
          setEditPermissions(null);
          setIsEditProductLoading(false);
        }
        return;
      }

      setIsEditProductLoading(true);
      try {
        const [{ data: productData, error: productError }, { data: editabilityData, error: editabilityError }] = await Promise.all([
          supabase
            .from('products')
            .select('id, title, description, price, bpm, key_signature, cover_image_url, is_published, file_format')
            .eq('id', editProductId)
            .eq('producer_id', profile.id)
            .maybeSingle(),
          supabase.rpc('can_edit_product', { p_product_id: editProductId }),
        ]);

        if (productError) throw productError;
        if (editabilityError) throw editabilityError;

        const sourceRow = (productData as EditProductRow | null) ?? null;
        const permissions = (editabilityData as EditPermissions | null) ?? null;

        if (!sourceRow) {
          throw new Error(t('uploadBeat.productNotFound'));
        }

        if (!permissions) {
          throw new Error(t('uploadBeat.editPermissionsError'));
        }

        if (!isCancelled) {
          setEditingProduct(sourceRow);
          setEditPermissions(permissions);
          setTitle(sourceRow.title);
          setPrice((sourceRow.price / 100).toString());
          setDescription(sourceRow.description ?? '');
          setBpm(sourceRow.bpm ? String(sourceRow.bpm) : '');
          setKeySignature(sourceRow.key_signature ?? '');
          setImagePreviewUrl(sourceRow.cover_image_url);
          setErrors((prev) => ({
            ...prev,
            form: permissions.must_create_new_version ? getEditLockMessage(permissions, t) : undefined,
          }));
        }
      } catch (error) {
        console.error('[upload-beat] failed to load edit product', error);
        if (!isCancelled) {
          setErrors((prev) => ({
            ...prev,
            form: getErrorMessage(error, t('uploadBeat.loadEditProductError')),
          }));
          setEditingProduct(null);
          setEditPermissions(null);
        }
      } finally {
        if (!isCancelled) {
          setIsEditProductLoading(false);
        }
      }
    };

    void loadEditProduct();

    return () => {
      isCancelled = true;
    };
  }, [editProductId, profile?.id, t]);

  const isProducerActive = profile?.is_producer_active ?? false;
  const hasValidationErrors = !!errors.audio || !!errors.image;
  const isSourceLoading = isVersionSourceLoading || isEditProductLoading;
  const requiresAudioFile = !isEditMode;
  const isMetadataLocked = isEditMode && editPermissions?.can_edit_metadata === false;
  const isPublishDisabled =
    (requiresAudioFile && !audioFile) ||
    !title.trim() ||
    !price ||
    hasValidationErrors ||
    isUploading ||
    !isProducerActive ||
    isSourceLoading ||
    (isVersionMode && !versionSource) ||
    (isEditMode && (!editingProduct || !editPermissions || !editPermissions.can_edit_metadata));

  const resetAudio = () => {
    revokeObjectUrl(audioPreviewUrl);
    setAudioFile(null);
    setAudioPreviewUrl(null);
    setAudioDuration(0);
    setUploadProgress((prev) => ({ ...prev, audio: 0 }));
    setUploadStatus((prev) => ({ ...prev, audio: 'idle' }));
  };

  const resetImage = () => {
    revokeObjectUrl(imagePreviewUrl);
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
      audio.onerror = () => reject(new Error(t('uploadBeat.audioReadError')));
    });

  const getImageDimensions = (src: string) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => reject(new Error(t('uploadBeat.imageReadError')));
      img.src = src;
    });

  const handleAudioChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (isEditMode && editPermissions && !editPermissions.can_edit_audio) {
      setErrors((prev) => ({
        ...prev,
        audio: getEditLockMessage(editPermissions, t),
      }));
      event.target.value = '';
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    resetAudio();

    const allowedTypes = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3'];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({ ...prev, audio: t('uploadBeat.audioFormatError') }));
      return;
    }

    if (file.size > MAX_AUDIO_SIZE) {
      setErrors((prev) => ({ ...prev, audio: t('uploadBeat.audioSizeError') }));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    try {
      const duration = await getAudioDuration(previewUrl);
      if (duration > MAX_AUDIO_DURATION) {
        throw new Error(t('uploadBeat.audioDurationError'));
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
        audio: error instanceof Error ? error.message : t('uploadBeat.audioInvalid'),
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
      setErrors((prev) => ({ ...prev, image: t('uploadBeat.imageFormatError') }));
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setErrors((prev) => ({ ...prev, image: t('uploadBeat.imageSizeError') }));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    try {
      const { width, height } = await getImageDimensions(previewUrl);
      if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
        throw new Error(t('uploadBeat.imageDimensionError'));
      }

      setImageFile(file);
      setImagePreviewUrl(previewUrl);
      setErrors((prev) => ({ ...prev, image: undefined }));
      setUploadStatus((prev) => ({ ...prev, image: 'idle' }));
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setErrors((prev) => ({
        ...prev,
        image: error instanceof Error ? error.message : t('uploadBeat.imageInvalid'),
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
    if (requiresAudioFile && !audioFile) {
      setErrors((prev) => ({ ...prev, form: t('producer.audioRequired') }));
      return;
    }

    if (isEditMode && !editPermissions?.can_edit_metadata) {
      setErrors((prev) => ({
        ...prev,
        form: getEditLockMessage(editPermissions, t),
      }));
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
    setIsWatermarkProcessing(false);

    const timestamp = Date.now();
    const slug = `${slugify(trimmedTitle)}-${timestamp}`;
    const priceCents = Math.round(priceValue * 100);
    let audioPath = '';
    let coverPath = '';
    let persistedVersion = false;
    let updatedExistingProduct = false;

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const producerId = authData.user?.id ?? profile?.id ?? null;
      if (authError || !producerId) {
        throw new Error(t('uploadBeat.sessionExpired'));
      }

      let masterStorageReference: string | null = null;
      if (audioFile) {
        audioPath = `${producerId}/audio/${timestamp}-${audioFile.name.replace(/\s+/g, '-')}`;
        setUploadProgress((prev) => ({ ...prev, audio: 15 }));
        const { data: audioData, error: audioError } = await supabase.storage
          .from(MASTER_BUCKET)
          .upload(audioPath, audioFile, {
            cacheControl: '3600',
            upsert: false,
          });

        if (audioError) {
          throw audioError;
        }

        const normalizedMasterPath = normalizeStoragePath(audioData?.path || audioPath, MASTER_BUCKET);
        if (!normalizedMasterPath) {
          throw new Error(t('uploadBeat.masterPathInvalid'));
        }
        masterStorageReference = `${MASTER_BUCKET}/${normalizedMasterPath}`;

        setUploadStatus((prev) => ({ ...prev, audio: 'success' }));
        setUploadProgress((prev) => ({ ...prev, audio: 100 }));
      }

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
        : editingProduct?.cover_image_url ?? versionSource?.cover_image_url ?? null;

      const basePayload: Database['public']['Tables']['products']['Insert'] = {
        producer_id: producerId,
        title: trimmedTitle,
        slug,
        description: description.trim() || null,
        product_type: 'beat',
        price: priceCents,
        bpm: bpm ? parseInt(bpm) : null,
        key_signature: keySignature || null,
        cover_image_url: coverPublicUrl,
        is_published: editingProduct?.is_published ?? true,
        duration_seconds: audioFile ? Math.round(audioDuration) || null : null,
        file_format: audioFile?.type || editingProduct?.file_format || 'audio/mpeg',
      };

      if (versionSource) {
        const versionPayload: Database['public']['Functions']['rpc_publish_product_version']['Args']['p_new_data'] = {
          ...basePayload,
          master_path: masterStorageReference,
          master_url: masterStorageReference,
          watermarked_bucket: versionSource.watermarked_bucket,
          is_exclusive: versionSource.is_exclusive,
          genre_id: versionSource.genre_id,
          mood_id: versionSource.mood_id,
          tags: versionSource.tags,
          license_terms: versionSource.license_terms,
        };

        const { error: versionPublishError } = await supabase.rpc('rpc_publish_product_version', {
          p_source_product_id: versionSource.id,
          p_new_data: versionPayload,
        });

        if (versionPublishError) {
          throw versionPublishError;
        }

        persistedVersion = true;
      } else if (editingProduct) {
        const updatePayload: Database['public']['Tables']['products']['Update'] = {
          title: trimmedTitle,
          description: description.trim() || null,
          price: priceCents,
          bpm: bpm ? parseInt(bpm) : null,
          key_signature: keySignature || null,
          cover_image_url: coverPublicUrl,
          updated_at: new Date().toISOString(),
        };

        if (masterStorageReference) {
          updatePayload.master_path = masterStorageReference;
          updatePayload.master_url = masterStorageReference;
          updatePayload.duration_seconds = Math.round(audioDuration) || null;
          updatePayload.file_format = audioFile?.type || editingProduct.file_format || 'audio/mpeg';
        }

        const { error: updateError } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('id', editingProduct.id);

        if (updateError) {
          throw updateError;
        }

        updatedExistingProduct = true;
      } else {
        const legacyPayload: Database['public']['Tables']['products']['Insert'] = {
          ...basePayload,
          preview_url: null,
          master_url: masterStorageReference,
        };

        const modernPayload: Database['public']['Tables']['products']['Insert'] = {
          ...basePayload,
          preview_url: null,
          watermarked_path: null,
          master_path: masterStorageReference,
          master_url: masterStorageReference,
        };

        const payloads = [modernPayload, legacyPayload];

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
      }

      setIsWatermarkProcessing(Boolean(versionSource || audioFile));
      toast.success(
        versionSource
          ? t('uploadBeat.versionPublished')
          : editingProduct
            ? (
              audioFile
                ? t('uploadBeat.productUpdatedWatermark')
                : t('uploadBeat.productUpdated')
            )
            : t('uploadBeat.beatPublished')
      );
      setErrors({});
      setTitle('');
      setPrice('');
      setDescription('');
      setBpm('');
      setKeySignature('');
      resetAudio();
      resetImage();
      setVersionSource(null);
      setEditingProduct(null);
      setEditPermissions(null);

      if (persistedVersion || updatedExistingProduct) {
        navigate('/producer');
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, t('uploadBeat.uploadError'));
      console.error('[upload-beat] upload failed', error);
      if (audioPath) {
        const { error: cleanupAudioError } = await supabase.storage.from(MASTER_BUCKET).remove([audioPath]);
        if (cleanupAudioError) {
          console.warn('[upload-beat] audio cleanup warning', cleanupAudioError);
        }
      }
      if (coverPath) {
        const { error: cleanupCoverError } = await supabase.storage.from(COVER_BUCKET).remove([coverPath]);
        if (cleanupCoverError) {
          console.warn('[upload-beat] cover cleanup warning', cleanupCoverError);
        }
      }
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
              {isEditMode ? t('uploadBeat.editBeat') : isVersionMode ? t('uploadBeat.newVersion') : (profile?.username || profile?.email)}
            </h1>
            <p className="text-zinc-400 mt-1">
              {isEditMode
                ? getEditModeDescription(editPermissions, t)
                : isVersionMode
                ? t('uploadBeat.prefillFromVersion', {
                  version: versionSource?.version_number ?? t('uploadBeat.sourceFallback'),
                })
                : t('producer.subscriptionRequired')}
            </p>
          </div>
        </header>

        {profile && !isProducerActive && (
          <div className="rounded-2xl border border-amber-700/50 bg-amber-900/10 p-5">
            <h2 className="text-lg font-semibold text-white">{t('uploadBeat.becomeProducerTitle')}</h2>
            <p className="mt-1 text-sm text-zinc-300">
              {t('uploadBeat.uploadReserved')}
            </p>
            <div className="mt-4">
              <Button variant="secondary" onClick={() => navigate('/pricing')}>
                {t('uploadBeat.viewPlans')}
              </Button>
            </div>
          </div>
        )}

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('producer.productTitle')}
              placeholder={t('uploadBeat.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUploading || isMetadataLocked}
            />
            <Input
              label={t('products.price')}
              type="number"
              placeholder={t('uploadBeat.pricePlaceholder')}
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={isUploading || isMetadataLocked}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              {t('producer.productDescription')}
            </label>
            <textarea
              rows={4}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
              placeholder={t('uploadBeat.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isUploading || isMetadataLocked}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('producer.productBpm')}
              type="number"
              placeholder={t('uploadBeat.bpmPlaceholder')}
              min="0"
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              disabled={isUploading || isMetadataLocked}
            />
            <Input
              label={t('products.key')}
              placeholder={t('uploadBeat.keyPlaceholder')}
              value={keySignature}
              onChange={(e) => setKeySignature(e.target.value)}
              disabled={isUploading || isMetadataLocked}
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
                  disabled={isUploading || (isEditMode && editPermissions?.can_edit_audio === false)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={isUploading || (isEditMode && editPermissions?.can_edit_audio === false)}
                  leftIcon={<UploadCloud className="w-4 h-4" />}
                >
                  {isEditMode && editPermissions?.can_edit_audio === false ? t('uploadBeat.audioLocked') : t('producer.chooseAudioFile')}
                </Button>
                {audioFile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => audioInputRef.current?.click()}
                    disabled={isUploading || (isEditMode && editPermissions?.can_edit_audio === false)}
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
                  {isEditMode && editPermissions?.can_edit_audio === false
                    ? t('uploadBeat.currentMasterKept')
                    : `${t('producer.fileMissing')} - ${t('producer.audioRequirements')}`}
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
                  disabled={isUploading || isMetadataLocked}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isUploading || isMetadataLocked}
                  leftIcon={<UploadCloud className="w-4 h-4" />}
                >
                  {isMetadataLocked ? t('uploadBeat.coverLocked') : t('producer.chooseCoverFile')}
                </Button>
                {imageFile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isUploading || isMetadataLocked}
                  >
                    {t('producer.replaceFile')}
                  </Button>
                )}
              </div>

              {imageFile || imagePreviewUrl ? (
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 space-y-2 transition-all duration-200">
                  {imageFile && (
                    <div className="flex items-center justify-between text-sm text-zinc-200">
                      <span className="truncate">{imageFile.name}</span>
                      <span className="text-xs text-zinc-500">{formatBytes(imageFile.size)}</span>
                    </div>
                  )}
                  {imagePreviewUrl && (
                    <div className="overflow-hidden rounded-lg border border-zinc-800">
                      <img
                        src={imagePreviewUrl}
                        alt={t('uploadBeat.coverPreviewAlt')}
                        className="w-full aspect-square object-cover"
                      />
                    </div>
                  )}
                  {!imageFile && imagePreviewUrl && (
                    <p className="text-xs text-zinc-500">
                      {t('uploadBeat.currentCoverKept')}
                    </p>
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
                  {isMetadataLocked
                    ? t('uploadBeat.metadataCoverLocked')
                    : `${t('producer.fileMissing')} - ${t('producer.coverRequirements')}`}
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

          {isSourceLoading && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
              {t('uploadBeat.loadingProduct')}
            </div>
          )}

          {isWatermarkProcessing && (
            <div className="rounded-lg border border-amber-700/60 bg-amber-900/15 px-3 py-2 text-sm text-amber-200">
              {t('uploadBeat.watermarkProcessing')}
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
              {!audioFile && requiresAudioFile && isProducerActive && (
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
