import serverless from "serverless-http";
import express from "express";
import type { Request, Response } from "express";

const app = express();

app.get("/health", (_req: Request, res: Response) => {
  return res.json({ status: "ok simple" });
});

export default serverless(app);
