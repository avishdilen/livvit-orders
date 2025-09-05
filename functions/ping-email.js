// functions/ping-email.js
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  try {
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const from = process.env.ORDERS_EMAIL_FROM || "onboarding@resend.dev";
    const to = qs.get("to") || process.env.ORDERS_EMAIL_TO;

    if (!to) {
      return { statusCode: 400, body: JSON.stringify({ data: null, error: { message: "ORDERS_EMAIL_TO not set" } }) };
    }

    const resp = await resend.emails.send({
      from,
      to,
      subject: "Livvitt → Resend test",
      text: "If you see this, Resend is configured correctly."
    });

    // Return the entire SDK response (either { data:{id}, error:null } or { data:null, error:{...} })
    return { statusCode: 200, body: JSON.stringify({ ...resp, used: { from, to } }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ data: null, error: { message: e.message } }) };
  }
};
