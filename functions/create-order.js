// functions/create-order.js
const { createClient } = require("@supabase/supabase-js");
const Busboy = require("busboy");
const { Resend } = require("resend");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE; // service_role (NOT anon)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ORDERS_EMAIL_TO = process.env.ORDERS_EMAIL_TO;
const ORDERS_EMAIL_FROM = process.env.ORDERS_EMAIL_FROM;

const resend = new Resend(RESEND_API_KEY);
const sanitize = (s) => String(s || "").replace(/[^a-z0-9._-]+/gi, "-");

// -------- helpers --------

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

async function emailOrder(meta, fileLinks) {
  const { orderNo, customer, items, totals, bank } = meta;

  const lines = (items || [])
    .map(
      (it) =>
        `• ${it.productLabel || it.product} — ${it.width}${it.unit} × ${it.height}${it.unit} × ${it.quantity}`
    )
    .join("\n");

  const linksText = (fileLinks || []).length
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

Bank Transfer (if applicable):
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

// -------- main handler --------

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // Normalize headers (case-insensitive)
    const H = Object.fromEntries(
      Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    const ct = (H["content-type"] || "").toLowerCase();

    // ---- Mode A: JSON body (direct-upload path) ----
    // Accept 'application/json' (with charset) and also 'text/plain' if the payload is JSON.
    const looksLikeJson =
      ct.includes("application/json") ||
      (ct.includes("text/plain") && typeof event.body === "string" && event.body.trim().startsWith("{"));

    if (looksLikeJson) {
      let parsed;
      try {
        parsed = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }

      const { meta, uploadedPaths = [] } = parsed;
      if (!meta?.orderNo) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing meta.orderNo" }) };
      }

      // Ensure bucket-relative paths (strip any accidental "orders/")
      const relPaths = uploadedPaths.map((p) => String(p).replace(/^orders\//, ""));

      let fileLinks = [];
      if (relPaths.length) {
        const { data, error } = await supabase
          .storage
          .from("orders")
          .createSignedUrls(relPaths, 60 * 60 * 24 * 7);

        if (error) {
          return {
            statusCode: 500,
            body: JSON.stringify({ error: "Signed URL error", detail: error.message }),
          };
        }
        fileLinks = data.map((d) => ({ path: d.path, url: d.signedUrl }));
      }

      await emailOrder(meta, fileLinks);
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          orderNo: meta.orderNo,
          uploaded: relPaths.length,
          files: fileLinks,
        }),
      };
    }

    // ---- Mode B: Multipart FormData (legacy small-file path) ----
    const { fields, files } = await parseMultipart(event);

    // meta.json can be a field or a file
    let meta;
    const metaFile = files.find(
      (f) => f.fieldname === "meta" || (f.filename || "").toLowerCase() === "meta.json"
    );
    if (metaFile) meta = JSON.parse(metaFile.data.toString("utf8"));
    else if (fields.meta) meta = JSON.parse(fields.meta);
    else return { statusCode: 400, body: JSON.stringify({ error: "Missing meta" }) };

    if (!meta?.orderNo) return { statusCode: 400, body: JSON.stringify({ error: "Missing orderNo in meta" }) };

    const fileProductMap = {};
    (meta.items || []).forEach((it) => {
      (it.files || []).forEach((fn) => {
        const name = typeof fn === "string" ? fn : fn?.name;
        if (name) fileProductMap[name] = it.product;
      });
    });

    const uploadedKeys = [];
    for (const f of files) {
      if (f === metaFile) continue;
      if (f.fieldname !== "files") continue;

      const product = fileProductMap[f.filename] || fields[`product_${f.fieldname}`] || fields.product;
      if (!product) {
        return { statusCode: 400, body: JSON.stringify({ error: `Missing product for file ${f.filename}` }) };
      }

      // Store at bucket-relative key (NO leading "orders/")
      const key = `${sanitize(meta.orderNo)}/${sanitize(product)}/${sanitize(f.filename)}`;

      const { error: upErr } = await supabase
        .storage
        .from("orders")
        .upload(key, f.data, { contentType: f.contentType, upsert: true });

      if (upErr) {
        return { statusCode: 500, body: JSON.stringify({ error: "Upload failed", detail: upErr.message }) };
      }
      uploadedKeys.push(key);
    }

    let fileLinks = [];
    if (uploadedKeys.length) {
      const { data, error } = await supabase
        .storage
        .from("orders")
        .createSignedUrls(uploadedKeys, 60 * 60 * 24 * 7);

      if (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Signed URL error", detail: error.message }) };
      }
      fileLinks = (data || []).map((d) => ({ path: d.path, url: d.signedUrl }));
    }

    await emailOrder(meta, fileLinks);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, orderNo: meta.orderNo, uploaded: uploadedKeys.length, files: fileLinks }),
    };
  } catch (e) {
    console.error("create-order error:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
