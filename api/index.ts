interface ApiRequest {
  method?: string;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => void;
}

export default function handler(_req: ApiRequest, res: ApiResponse) {
  return res.status(404).json({ error: "Use /api/generate-contract" });
}
