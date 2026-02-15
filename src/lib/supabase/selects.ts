export const PRODUCT_SAFE_COLUMNS = [
  'id',
  'producer_id',
  'title',
  'slug',
  'description',
  'product_type',
  'genre_id',
  'mood_id',
  'bpm',
  'key_signature',
  'price',
  'watermarked_path',
  'preview_url',
  'exclusive_preview_url',
  'cover_image_url',
  'is_exclusive',
  'is_sold',
  'sold_at',
  'sold_to_user_id',
  'is_published',
  'play_count',
  'tags',
  'duration_seconds',
  'file_format',
  'license_terms',
  'watermark_profile_id',
  'created_at',
  'updated_at',
].join(', ');

export const PRODUCT_RELATIONS_COLUMNS = [
  'id',
  'username',
  'avatar_url',
].join(', ');

export const GENRE_SAFE_COLUMNS = [
  'id',
  'name',
  'name_en',
  'name_de',
  'slug',
].join(', ');

export const MOOD_SAFE_COLUMNS = [
  'id',
  'name',
  'name_en',
  'name_de',
  'slug',
].join(', ');
