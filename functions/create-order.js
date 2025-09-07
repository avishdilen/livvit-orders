// functions/create-order.js
const { createClient } = require("@supabase/supabase-js");
const Busboy = require("busboy");
const { Resend } = require("resend");

// --- Env ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE; // service_role (NOT anon)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ORDERS_EMAIL_TO = process.env.ORDERS_EMAIL_TO;             // e.g., info@livvittplus.com
const ORDERS_EMAIL_FROM = process.env.ORDERS_EMAIL_FROM;         // e.g., orders@yourdomain.com (or onboarding@resend.dev)

const resend = new Resend(RESEND_API_KEY);

// Parse multipart/form-data from Netlify event
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
          fieldname,
          filename,
          contentType: mimeType || "application/octet-stream",
          data: Buffer.concat(chunks),
        });
      });
    });

    bb.on("field", (name, val) => (fields[name] = val));
    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, files }));

    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    bb.end(body);
  });
}

const sanitize = (s) => String(s || "").replace(/[^a-z0-9._-]+/gi, "-");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 1) Parse form
    const { fields, files } = await parseMultipart(event);

    // meta.json can come as a field or a file
    let meta;
    const metaFile = files.find(
      (f) => f.fieldname === "meta" || (f.filename || "").toLowerCase() === "meta.json"
    );
    if (metaFile) {
      meta = JSON.parse(metaFile.data.toString("utf8"));
    } else if (fields.meta) {
      meta = JSON.parse(fields.meta);
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing meta" }) };
    }

    const { orderNo, customer, items, totals, bank } = meta;
    if (!orderNo) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing orderNo in meta" }) };
    }

    // 2) Upload files to Supabase Storage
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const bucket = "orders"; // must exist (private)
    const uploadedKeys = [];

    for (const f of files) {
      if (f === metaFile) continue;         // skip meta.json
      if (f.fieldname !== "files") continue; // only artwork files

      const key = `orders/${sanitize(orderNo)}/${sanitize(f.filename)}`;
      const { error: upErr } = await supabase
        .storage
        .from(bucket)
        .upload(key, f.data, { contentType: f.contentType, upsert: true });

      if (upErr) {
        return { statusCode: 500, body: JSON.stringify({ error: "Upload failed", detail: upErr.message }) };
      }
      uploadedKeys.push(key);
    }

    // 3) Create signed URLs (valid 7 days)
    let fileLinks = [];
    if (uploadedKeys.length) {
      const { data, error } = await supabase
        .storage
        .from(bucket)
        .createSignedUrls(uploadedKeys, 60 * 60 * 24 * 7);

      if (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Signed URL error", detail: error.message }) };
      }
      fileLinks = (data || []).map((d) => ({ path: d.path, url: d.signedUrl }));
    }

    // 4) Send email via Resend
    const lines = (items || [])
      .map(
        (it) =>
          `• ${it.productLabel || it.product} — ${it.width}${it.unit} × ${it.height}${it.unit} × ${it.quantity}`
      )
      .join("\n");

    const linksText = fileLinks.length
      ? fileLinks.map((f) => `- ${f.path.split("/").pop()}: ${f.url}`).join("\n")
      : "(no files attached)";

    const text = `
NEW ORDER: ${orderNo}

Customer:
  ${customer?.name || ""}
  ${customer?.email || ""}${customer?.phone ? " / " + customer.phone : ""}

Items:
${lines || "(no line items provided)"}

Totals:
  Subtotal: ${totals?.orderSubtotal ?? ""}
  Discounts: ${totals?.orderDiscount ?? ""}
  Total: ${totals?.orderTotal ?? ""}

Bank Transfer (share with customer if unpaid):
  Beneficiary: ${bank?.beneficiary || ""}
  Bank: ${bank?.bankName || ""}
  Account: ${bank?.account || ""}
  IBAN: ${bank?.iban || ""}
  SWIFT: ${bank?.swift || ""}
  Currency: ${bank?.currency || ""}
  Reference: ${orderNo}

Files:
${linksText}
`.trim();

    // send to you + customer (if provided)
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
      // still return 200 so customer gets confirmation in the UI; you can inspect function logs
    }

    // 5) Respond
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        orderNo,
        uploaded: uploadedKeys.length,
        files: fileLinks,
      }),
    };
  } catch (e) {
    console.error("create-order error:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
