import contractServiceHandler from "../contract-service/dist/index.js";

export default async function handler(req: any, res: any) {
  const queryIndex = typeof req.url === "string" ? req.url.indexOf("?") : -1;
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : "";
  req.url = `/generate-contract${query}`;
  return contractServiceHandler(req, res);
}
