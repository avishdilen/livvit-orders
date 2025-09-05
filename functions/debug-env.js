// functions/debug-env.js
exports.handler = async () => {
  const hasKey = !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith("re_");
  return {
    statusCode: 200,
    body: JSON.stringify({
      has_RESEND_API_KEY: hasKey,
      ORDERS_EMAIL_FROM: process.env.ORDERS_EMAIL_FROM || null,
      ORDERS_EMAIL_TO: process.env.ORDERS_EMAIL_TO || null
    })
  };
};
