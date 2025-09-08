// functions/create-order.js
const { createClient } = require("@supabase/supabase-js");
const Busboy = require("busboy");
const { Resend } = require("resend");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE; // service_role
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ORDERS_EMAIL_TO = process.env.ORDERS_EMAIL_TO;
const ORDERS_EMAIL_FROM = process.env.ORDERS_EMAIL_FROM;

const resend = new Resend(RESEND_API_KEY);
const sanitize = (s) => String(s || "").replace(/[^a-z0-9._-]+/gi, "-");

// ---------- helpers ----------
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const headers = event.headers || {};
    const contentType = headers["content-type"] || headers["Content-Type"];
    if (!contentType) return reject(new Error("Missing content-type"));

    const bb = Busboy({ headers: { "content-type": contentType } });
    const fields = {};
    const files = [];

    bb.on("file", (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        files.push({
          fieldname, filename,
          contentType: mimeType || "application/octet-stream",
          data: Buffer.concat(chunks),
        });
      });
    });

    bb.on("field", (name, val) => (fields[name] = val));
    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, files }));

    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64")
                                       : Buffer.from(event.body || "", "utf8");
    bb.end(body);
  });
}

function groupLinksByItem(meta, filesByItem) {
  // Build an email section per line item
  const byId = {};
  (filesByItem || []).forEach(f => {
    (byId[f.itemId] = byId[f.itemId] || []).push(f.url);
  });

  const lines = (meta.items || []).map((it, idx) => {
    const files = byId[it.id] || [];
    const title = `${idx + 1}) ${it.productLabel || it.product} — ${it.width}${it.unit} × ${it.height}${it.unit} × ${it.quantity}`;
    const list = files.length ? files.map(u => `     - ${u}`).join("\n") : "     (no file)";
    return `${title}\n${list}`;
  }).join("\n\n");

  return lines || "(no line items provided)";
}

async function emailOrder(meta, filesByItem) {
  const { orderNo, customer, totals, bank } = meta;
  const itemSection = groupLinksByItem(meta, filesByItem);

  const text = `
NEW ORDER: ${orderNo}

Customer:
  ${customer?.name || ""}
  ${customer?.email || ""}${customer?.phone ? " / " + customer.phone : ""}

Items & Files:
${itemSection}

Totals:
  Subtotal: ${totals?.orderSubtotal ?? ""}
  Discounts: ${totals?.orderDiscount ?? ""}
  Total: ${totals?.orderTotal ?? ""}

Bank Transfer (if applicable):
  Beneficiary: ${bank?.beneficiary || ""}
  Bank: ${bank?.bankName || ""}
  Account: ${bank?.account || ""}
  IBAN: ${bank?.iban || ""}
  SWIFT: ${bank?.swift || ""}
  Currency: ${bank?.currency || ""}
  Reference: ${orderNo}
`.trim();

  try {
    await resend.emails.send({
      from: ORDERS_EMAIL_FROM,
      to: [ORDERS_EMAIL_TO, customer?.email].filter(Boolean),
      subject: `Order ${orderNo} — Files & Details`,
      text,
    });
    console.log("Resend OK for order:", orderNo);
  } catch (e) {
    console.error("Resend FAILED:", e?.message || e);
  }
}

// ---------- main ----------
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // Normalize header
    const H = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(), v]));
    const ct = (H["content-type"] || "").toLowerCase();

    // ---- A) JSON mode: { meta, uploadedByItem:[{itemId, path}] }
    const looksLikeJson =
      ct.includes("application/json") ||
      (ct.includes("text/plain") && typeof event.body === "string" && event.body.trim().startsWith("{"));

    if (looksLikeJson) {
      const { meta, uploadedByItem = [] } = JSON.parse(event.body || "{}");
      if (!meta?.orderNo) return { statusCode: 400, body: JSON.stringify({ error: "Missing meta.orderNo" }) };

      const relPaths = uploadedByItem.map(x => String(x.path).replace(/^orders\//, "")); // bucket-relative
      let urls = [];
      if (relPaths.length) {
        const { data, error } = await supabase
          .storage.from("orders")
          .createSignedUrls(relPaths, 60 * 60 * 24 * 7);
        if (error) return { statusCode: 500, body: JSON.stringify({ error: "Signed URL error", detail: error.message }) };
        urls = data; // array of { path, signedUrl }
      }

      // stitch back itemId + signed url
      const filesByItem = uploadedByItem.map(x => {
        const m = urls.find(u => u.path === x.path.replace(/^orders\//, ""));
        return { itemId: x.itemId, path: (m?.path || x.path), url: m?.signedUrl || null };
      });

      await emailOrder(meta, filesByItem);

      return { statusCode: 200, body: JSON.stringify({ ok: true, orderNo: meta.orderNo, filesByItem }) };
    }

    // ---- B) Multipart legacy (kept for backward compatibility) ----
    const { fields, files } = await parseMultipart(event);

    let meta;
    const metaFile = files.find(f => f.fieldname === "meta" || (f.filename || "").toLowerCase() === "meta.json");
    if (metaFile) meta = JSON.parse(metaFile.data.toString("utf8"));
    else if (fields.meta) meta = JSON.parse(fields.meta);
    else return { statusCode: 400, body: JSON.stringify({ error: "Missing meta" }) };

    if (!meta?.orderNo) return { statusCode: 400, body: JSON.stringify({ error: "Missing orderNo in meta" }) };

    const uploaded = [];
    for (const f of files) {
      if (f === metaFile) continue;
      if (f.fieldname !== "files") continue;
      // legacy: store under order root
      const key = `${sanitize(meta.orderNo)}/${sanitize(f.filename)}`;
      const { error: upErr } = await supabase.storage.from("orders").upload(key, f.data, { contentType: f.contentType, upsert: true });
      if (upErr) return { statusCode: 500, body: JSON.stringify({ error: "Upload failed", detail: upErr.message }) };
      uploaded.push({ itemId: null, path: key });
    }

    let urls = [];
    if (uploaded.length) {
      const { data, error } = await supabase
        .storage.from("orders")
        .createSignedUrls(uploaded.map(u => u.path), 60 * 60 * 24 * 7);
      if (error) return { statusCode: 500, body: JSON.stringify({ error: "Signed URL error", detail: error.message }) };
      urls = data;
    }

    const filesByItem = uploaded.map((u, i) => ({ itemId: null, path: urls[i].path, url: urls[i].signedUrl }));
    await emailOrder(meta, filesByItem);

    return { statusCode: 200, body: JSON.stringify({ ok: true, orderNo: meta.orderNo, filesByItem }) };
  } catch (e) {
    console.error("create-order error:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
