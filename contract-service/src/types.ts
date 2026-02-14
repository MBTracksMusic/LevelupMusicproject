export interface PurchaseContractPayload {
  id: string;
  license_type: string | null;
  contract_pdf_path: string | null;
  completed_at: string | null;
  buyer: {
    username: string | null;
  } | null;
  product: {
    title: string | null;
    producer: {
      username: string | null;
    } | null;
  } | null;
}
