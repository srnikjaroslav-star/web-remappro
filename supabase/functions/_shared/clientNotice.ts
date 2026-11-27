export type MailAttachment = {
  filename: string;
  content: string;
};

export const sendClientEmail = async (input: {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}) => {
  const key = Deno.env.get("RESEND_API_KEY") ?? "";
  const recipient = input.to.trim();
  if (!key) {
    console.error("[mail] RESEND_API_KEY is not set");
    return false;
  }
  if (!recipient) {
    console.error("[mail] recipient is empty");
    return false;
  }
  const sender = Deno.env.get("RESEND_SENDER_EMAIL") || "REMAPPRO <info@remappro.eu>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: input.subject,
        html: input.html,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    if (!response.ok) {
      console.error("[mail]", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("[mail]", error);
    return false;
  }
};

export const clientMailShell = (title: string, body: string, lang: "SK" | "EN") => `<!DOCTYPE html>
<html lang="${lang === "EN" ? "en" : "sk"}">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f4f7fb;color:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dbe7f5;border-radius:12px;">
        <tr><td style="padding:28px 32px 18px;border-bottom:3px solid #0e63c4;">
          <div style="font-size:22px;font-weight:800;letter-spacing:1px;">REMAP<span style="color:#0e63c4;">PRO</span></div>
          <div style="margin-top:6px;color:#0e63c4;font-size:12px;font-weight:700;">Automotive Electronics &amp; Software Calibration</div>
          <div style="margin-top:14px;font-size:18px;font-weight:700;">${title}</div>
        </td></tr>
        <tr><td style="padding:24px 32px;font-size:15px;line-height:1.55;">${body}</td></tr>
        <tr><td style="padding:14px 32px 22px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">
          REMAPPRO | Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia | IČO: 41281471 | DIČ: 1041196607 | info@remappro.eu
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
