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
    "measured_lufs",
    "measured_true_peak_db",
    "normalization_applied",
    "normalization_error",
].join(", ");
export const claimAudioProcessingJobs = async (supabase, limit, workerId) => {
    const { data, error } = await supabase.rpc("claim_audio_processing_jobs", {
        p_limit: limit,
        p_worker: workerId,
    });
    if (error) {
        throw new Error(`claim_audio_processing_jobs failed: ${error.message}`);
    }
    return (data ?? []);
};
export const loadSiteAudioSettings = async (supabase) => {
    const { data: settings, error } = await supabase
        .from("site_audio_settings")
        .select("*")
        .eq("enabled", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
    if (error) {
        throw new Error(`Failed to load site_audio_settings: ${error.message}`);
    }
    if (!settings) {
        throw new Error("active site_audio_settings row not found");
    }
    return settings;
};
export const loadProductForProcessing = async (supabase, productId) => {
    const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("id", productId)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to load product ${productId}: ${error.message}`);
    }
    return data ?? null;
};
export const updateAudioProcessingJob = async (supabase, jobId, payload) => {
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
export const updateProductProcessingState = async (supabase, productId, payload) => {
    const { error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", productId);
    if (error) {
        throw new Error(`Failed to update products(${productId}): ${error.message}`);
    }
};
