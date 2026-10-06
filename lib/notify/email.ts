import nodemailer from 'nodemailer';

let transport: nodemailer.Transporter | null = null;

export const emailEnabled = () => !!process.env.SMTP_URL && !!process.env.SMTP_FROM;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!emailEnabled()) throw new Error('Email is not configured');
  transport ??= nodemailer.createTransport(process.env.SMTP_URL!);
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}
