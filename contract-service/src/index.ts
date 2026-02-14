import "dotenv/config";
import fs from "node:fs/promises";
import express, { type Request, type Response } from "express";
import { supabase } from "./supabaseClient.js";
import { generatePDF } from "./generatePDF.js";
import type { PurchaseContractPayload } from "./types.js";

const app = express();
app.use(express.json());

const contractServiceSecret = process.env.CONTRACT_SERVICE_SECRET;

if (!contractServiceSecret) {
  throw new Error("Missing CONTRACT_SERVICE_SECRET");
}

const toOne = <T>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

app.get("/health", (_req: Request, res: Response) => {
  return res.json({ status: "ok" });
});

app.post("/generate-contract", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${contractServiceSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const purchaseId = typeof req.body?.purchase_id === "string"
    ? req.body.purchase_id
    : "";

  if (!purchaseId) {
    return res.status(400).json({ error: "Missing purchase_id" });
  }

  try {
    const { data, error } = await supabase
      .from("purchases")
      .select(`
        id,
        license_type,
        contract_pdf_path,
        completed_at,
        buyer:user_profiles!purchases_user_id_fkey(username),
        product:products!purchases_product_id_fkey(
          title,
          producer:user_profiles!products_producer_id_fkey(username)
        )
      `)
      .eq("id", purchaseId)
      .single();

    if (error) {
      console.error("[contract-service] Purchase fetch failed", error);
      return res.status(500).json({ error: "Failed to load purchase" });
    }

    const rawPurchase = data as {
      id: string;
      license_type: string | null;
      contract_pdf_path: string | null;
      completed_at: string | null;
      buyer: { username: string | null } | { username: string | null }[] | null;
      product:
        | {
            title: string | null;
            producer: { username: string | null } | { username: string | null }[] | null;
          }
        | {
            title: string | null;
            producer: { username: string | null } | { username: string | null }[] | null;
          }[]
        | null;
    } | null;

    if (!rawPurchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    const buyer = toOne(rawPurchase.buyer);
    const product = toOne(rawPurchase.product);
    const producer = toOne(product?.producer ?? null);

    const purchase: PurchaseContractPayload = {
      id: rawPurchase.id,
      license_type: rawPurchase.license_type,
      contract_pdf_path: rawPurchase.contract_pdf_path,
      completed_at: rawPurchase.completed_at,
      buyer: buyer ? { username: buyer.username } : null,
      product: product
        ? {
            title: product.title,
            producer: producer ? { username: producer.username } : null,
          }
        : null,
    };

    if (purchase.contract_pdf_path) {
      return res.json({ status: "already_generated", path: purchase.contract_pdf_path });
    }

    const producerName = purchase.product?.producer?.username || "Producteur";
    const buyerName = purchase.buyer?.username || "Acheteur";
    const trackTitle = purchase.product?.title || "Titre";
    const contractDate = new Date(purchase.completed_at || Date.now()).toLocaleDateString("fr-FR");
    const licenseType = purchase.license_type || "standard";

    const content = [
      `Producteur: ${producerName}`,
      `Acheteur: ${buyerName}`,
      `Titre: ${trackTitle}`,
      `Date: ${contractDate}`,
      `Licence: ${licenseType}`,
      "",
      "Credit obligatoire:",
      `Prod by ${producerName}`,
    ].join("\n");

    const tmpPath = `/tmp/${purchaseId}.pdf`;
    const storagePath = `contracts/${purchaseId}.pdf`;

    try {
      await generatePDF(tmpPath, content);
      const fileBuffer = await fs.readFile(tmpPath);

      const { error: uploadError } = await supabase.storage
        .from("contracts")
        .upload(storagePath, fileBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) {
        console.error("[contract-service] Upload failed", uploadError);
        return res.status(500).json({ error: "Failed to upload contract PDF" });
      }
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }

    const { error: updateError } = await supabase
      .from("purchases")
      .update({ contract_pdf_path: storagePath })
      .eq("id", purchaseId);

    if (updateError) {
      console.error("[contract-service] Purchase update failed", updateError);
      return res.status(500).json({ error: "Failed to update purchase contract path" });
    }

    return res.json({ status: "contract_generated", path: storagePath });
  } catch (error) {
    console.error("[contract-service] Unexpected error", error);
    return res.status(500).json({ error: "Internal error" });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`[contract-service] listening on port ${port}`);
});
