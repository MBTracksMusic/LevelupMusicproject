export interface LicensePayload {
  id: string;
  name: string;
  description: string | null;
  max_streams: number | null;
  max_sales: number | null;
  youtube_monetization: boolean;
  music_video_allowed: boolean;
  credit_required: boolean;
  exclusive_allowed: boolean;
  price: number;
}

export interface PurchaseContractPayload {
  id: string;
  license_id: string | null;
  license_type: string | null;
  contract_pdf_path: string | null;
  contract_email_sent_at: string | null;
  completed_at: string | null;
  buyer: {
    username: string | null;
    full_name: string | null;
    email: string | null;
  } | null;
  product: {
    title: string | null;
    producer: {
      username: string | null;
      email: string | null;
    } | null;
  } | null;
  license: LicensePayload | null;
}

export interface ContractPdfRightRow {
  label: string;
  value: string;
}

export interface ContractPdfPayload {
  purchaseId: string;
  contractDate: string;
  producerName: string;
  buyerName: string;
  trackTitle: string;
  licenseName: string;
  licenseDescription: string;
  rights: ContractPdfRightRow[];
  creditClause: string;
}
