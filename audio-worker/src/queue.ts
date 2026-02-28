import type {
  AudioProcessingJobRow,
  ProductRow,
  SiteAudioSettingsRow,
  SupabaseAdminClient,
} from "./types.js";

const PRODUCT_SELECT = [
  "id",
  "producer_id",
  "title",
  "product_type",
  "is_published",
  "deleted_at",
  "preview_url",
  "watermarked_path",
  "exclusive_preview_url",
  "master_path",
  "master_url",
  "preview_version",
  "preview_signature",
  "last_watermark_hash",
  "file_format",
  "watermarked_bucket",
  "processing_status",
  "processing_error",
  "processed_at",
].join(", ");

const SITE_AUDIO_SETTINGS_SELECT = [
  "id",
  "enabled",
  "watermark_audio_path",
  "gain_db",
  "min_interval_sec",
  "max_interval_sec",
  "created_at",
  "updated_at",
].join(", ");

const isClaimArgumentMismatch = (error: { message?: string; details?: string; hint?: string }) => {
  const message = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    message.includes("p_limit") ||
    message.includes("p_worker") ||
    message.includes("worker_id") ||
    message.includes("function") ||
    message.includes("argument")
  );
};

export const claimAudioProcessingJobs = async (
  supabase: SupabaseAdminClient,
  limit: number,
  workerId: string,
): Promise<AudioProcessingJobRow[]> => {
  const attempts = [
    { p_limit: limit, p_worker: workerId },
    { limit, worker_id: workerId },
  ];

  let lastError: Error | null = null;

  for (const args of attempts) {
    const { data, error } = await supabase.rpc("claim_audio_processing_jobs", args);
    if (!error) {
      return (data ?? []) as AudioProcessingJobRow[];
    }

    lastError = new Error(`claim_audio_processing_jobs failed: ${error.message}`);
    if (!isClaimArgumentMismatch(error)) {
      break;
    }
  }

  throw lastError ?? new Error("claim_audio_processing_jobs failed");
};

export const loadSiteAudioSettings = async (
  supabase: SupabaseAdminClient,
): Promise<SiteAudioSettingsRow> => {
  const { data, error } = await supabase
    .from("site_audio_settings")
    .select(SITE_AUDIO_SETTINGS_SELECT)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load site_audio_settings: ${error.message}`);
  }

  if (!data) {
    throw new Error("site_audio_settings row not found");
  }

  return data as unknown as SiteAudioSettingsRow;
};

export const loadProductForProcessing = async (
  supabase: SupabaseAdminClient,
  productId: string,
): Promise<ProductRow | null> => {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load product ${productId}: ${error.message}`);
  }

  return (data as unknown as ProductRow | null) ?? null;
};

export const updateAudioProcessingJob = async (
  supabase: SupabaseAdminClient,
  jobId: string,
  payload: Record<string, unknown>,
) => {
  const { error } = await supabase
    .from("audio_processing_jobs")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to update audio_processing_jobs(${jobId}): ${error.message}`);
  }
};

export const updateProductProcessingState = async (
  supabase: SupabaseAdminClient,
  productId: string,
  payload: Record<string, unknown>,
) => {
  const { error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", productId);

  if (error) {
    throw new Error(`Failed to update products(${productId}): ${error.message}`);
  }
};
