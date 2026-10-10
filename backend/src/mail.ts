import nodemailer from "nodemailer";
import { config } from "./config.js";

const transport = config.smtp
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, html: string) {
  if (!transport) {
    console.log(`[mail:dev] to=${to} subject=${subject}\n${html.replace(/<[^>]+>/g, " ")}`);
    return;
  }
  await transport.sendMail({ from: config.smtp!.from, to, subject, html });
}

export function layout(title: string, body: string) {
  return `<div style="font-family:Onest,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1B1C21;background:#EDEDED">
  <div style="font:800 20px 'JetBrains Mono',Consolas,monospace;letter-spacing:-.04em;padding-bottom:16px;border-bottom:1.5px solid #1B1C21">шаурматч<span style="color:#FF8A1F">_</span></div>
  <h1 style="font:800 24px 'JetBrains Mono',Consolas,monospace;letter-spacing:-.03em;margin:24px 0 12px">${title}</h1>${body}
  <p style="color:#6B6C72;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px solid #D9D9D9">ИТ-найм наоборот · хакатон «Лидеры цифровой трансформации 2026», спецтрек ФСП</p></div>`;
}

export const button = (href: string, text: string) =>
  `<a href="${href}" style="display:inline-block;background:#402FFF;color:#fff;padding:14px 24px;text-decoration:none;font-weight:700">${text}</a>`;
