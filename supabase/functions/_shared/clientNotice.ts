import { LOGO_BASE64 } from "./invoiceLogo.ts";

export type MailAttachment = {
  filename: string;
  content: string;
  content_id?: string;
};

const LOGO_CID = "remappro-logo";

const logoAttachment = (): MailAttachment => {
  const marker = "base64,";
  const splitAt = LOGO_BASE64.indexOf(marker);
  return {
    filename: "remappro-logo.jpg",
    content: splitAt >= 0 ? LOGO_BASE64.slice(splitAt + marker.length) : LOGO_BASE64,
    content_id: LOGO_CID,
  };
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
  const attachments = [
    ...(input.html.includes(`cid:${LOGO_CID}`) ? [logoAttachment()] : []),
    ...(input.attachments ?? []),
  ];
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
        ...(attachments.length ? { attachments } : {}),
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
          <img src="cid:${LOGO_CID}" alt="REMAPPRO" width="280" height="70" style="width:280px;max-width:100%;height:auto;display:block;border:0;outline:none;text-decoration:none;">
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
