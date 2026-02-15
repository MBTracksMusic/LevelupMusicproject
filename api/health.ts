import contractServiceHandler from "../contract-service/dist/index.js";

export default function handler(req: any, res: any) {
  req.url = "/health";
  return contractServiceHandler(req, res);
}
