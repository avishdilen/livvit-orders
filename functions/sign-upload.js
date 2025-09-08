// functions/sign-upload.js
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

function sanitize(s) { return String(s || "").replace(/[^a-z0-9._-]+/gi, "-"); }

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    const { orderNo, filename, itemId } = JSON.parse(event.body || "{}");
    if (!orderNo || !filename || !itemId) {
      return { statusCode: 400, body: JSON.stringify({ error: "orderNo, filename, itemId required" }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    // Bucket-relative path: <orderNo>/<itemId>/<filename>
    const objectPath = `${sanitize(orderNo)}/${sanitize(itemId)}/${sanitize(filename)}`;

    const { data, error } = await supabase
      .storage.from("orders")
      .createSignedUploadUrl(objectPath);

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    return { statusCode: 200, body: JSON.stringify({ signedUrl: data.signedUrl, path: objectPath, itemId }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
