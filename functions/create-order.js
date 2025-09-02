
const { createClient } = require("@supabase/supabase-js");
const Busboy = require("busboy");
const { Resend } = require("resend");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ORDERS_EMAIL_TO = process.env.ORDERS_EMAIL_TO;        // e.g., info@livvittplus.com
const ORDERS_EMAIL_FROM = process.env.ORDERS_EMAIL_FROM;    // e.g., orders@livvittplus.com (verified)

const resend = new Resend(RESEND_API_KEY);

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
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    bb.end(body);
  });
}

function sanitize(name) {
  return String(name || "").replace(/[^a-z0-9._-]+/gi, "-");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { fields, files } = await parseMultipart(event);

    // meta.json (order info)
    let meta;
    const metaFile = files.find((f) => f.fieldname === "meta" || (f.filename || "").toLowerCase() === "meta.json");
    if (metaFile) {
      meta = JSON.parse(metaFile.data.toString("utf8"));
    } else if (fields.meta) {
      meta = JSON.parse(fields.meta);
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing meta" }) };
    }

    const { orderNo, customer, items, totals, bank } = meta;

    // Upload to Supabase Storage
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const uploadKeys = [];
    for (const f of files) {
      if (f === metaFile) continue;
      if (f.fieldname !== "files") continue;
      const key = `orders/${sanitize(orderNo)}/${sanitize(f.filename)}`;
      const { error: upErr } = await supabase
        .storage
        .from("orders")
        .upload(key, f.data, { contentType: f.contentType, upsert: true });
      if (upErr) {
        return { statusCode: 500, body: JSON.stringify({ error: "Upload failed", detail: upErr.message }) };
      }
      uploadKeys.push(key);
    }

    // Signed URLs (7 days)
    let fileLinks = [];
    if (uploadKeys.length) {
      const { data, error } = await supabase
        .storage
        .from("orders")
        .createSignedUrls(uploadKeys, 60 * 60 * 24 * 7);
      if (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Signed URL error", detail: error.message }) };
      }
      fileLinks = data.map((d) => ({ path: d.path, url: d.signedUrl }));
    }

    const lines = items
      .map((it) => `• ${it.productLabel} — ${it.width}${it.unit} × ${it.height}${it.unit} × ${it.quantity}`)
      .join("\n");

    const links = fileLinks.length
      ? fileLinks.map((f) => `- ${f.path.split("/").pop()}: ${f.url}`).join("\n")
      : "(no files)";

    const text = `
NEW ORDER: ${orderNo}

Customer:
  ${customer.name}
  ${customer.email}${customer.phone ? " / " + customer.phone : ""}

Items:
${lines}

Totals:
  Subtotal: ${totals.orderSubtotal}
  Discounts: ${totals.orderDiscount}
  Total: ${totals.orderTotal}

Bank Transfer (share with customer):
  Beneficiary: ${bank.beneficiary}
  Bank: ${bank.bankName}
  Account: ${bank.account}
  IBAN: ${bank.iban}
  SWIFT: ${bank.swift}
  Currency: ${bank.currency}
  Reference: ${orderNo}

Files:
${links}
`;

    await resend.emails.send({
      from: ORDERS_EMAIL_FROM,
      to: [ORDERS_EMAIL_TO, customer.email].filter(Boolean),
      subject: `Order ${orderNo} — Bank Transfer & Uploads`,
      text,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, orderNo }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
