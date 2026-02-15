import serverless from "serverless-http";
import express from "express";

const app = express();

app.get("/health", (_req, res) => {
  return res.json({ status: "ok simple" });
});

export default serverless(app);
