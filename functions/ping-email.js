// functions/ping-email.js
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async () => {
  try {
    const from = process.env.ORDERS_EMAIL_FROM || "onboarding@resend.dev";
    const to = process.env.ORDERS_EMAIL_TO;
    const result = await resend.emails.send({
      from,
      to,
      subject: "Livvitt → Resend test",
      text: "If you see this, Resend is configured correctly."
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result?.data?.id || null }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
