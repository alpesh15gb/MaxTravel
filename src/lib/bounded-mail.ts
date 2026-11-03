import nodemailer from "nodemailer";
import { connect, type Socket } from "node:net";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export const MAIL_DEADLINE_MS = 30_000;
export const SMTP_PHASE_TIMEOUT_MS = 10_000;

/** One owned TCP socket per message. Destroying it also terminates STARTTLS/TLS.
 * A timeout is delivery-ambiguous: the server may already have accepted DATA.
 * SMTP transport.close() alone does not abort its active connections.
 */
export async function boundedMail(options: SMTPTransport.Options, message: SMTPTransport.MailOptions,
  dependencies = { createTransport: nodemailer.createTransport, connect,
    setTimeout, clearTimeout }) {
  let socket: Socket | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadlineError = new Error("Email delivery deadline exceeded; delivery may have occurred.");
  const transporter = dependencies.createTransport({ ...options,
    connectionTimeout: SMTP_PHASE_TIMEOUT_MS,
    greetingTimeout: SMTP_PHASE_TIMEOUT_MS,
    socketTimeout: SMTP_PHASE_TIMEOUT_MS,
    dnsTimeout: SMTP_PHASE_TIMEOUT_MS,
    getSocket(_options, callback) {
      if (finished) { callback(deadlineError, false); return; }
      // Supply a connected plain socket; Nodemailer performs implicit TLS when
      // secure=true and STARTTLS otherwise, retaining its certificate validation.
      try {
        socket = dependencies.connect({ host: options.host!, port: Number(options.port) });
      } catch (error) {
        callback(error instanceof Error ? error : new Error("Email connection failed."), false);
        return;
      }
      const onError = (error: Error) => callback(error, false);
      socket.once("error", onError);
      socket.once("connect", () => {
        socket!.removeListener("error", onError);
        if (finished) { socket!.destroy(); callback(deadlineError, false); return; }
        callback(null, { connection: socket });
      });
    },
  } as SMTPTransport.Options);
  try {
    await new Promise<void>((resolve, reject) => {
      timer = dependencies.setTimeout(() => {
        finished = true;
        socket?.destroy(); // Abort the actual I/O BEFORE reporting timeout.
        reject(deadlineError);
      }, MAIL_DEADLINE_MS);
      transporter.sendMail(message).then(() => resolve(), reject);
    });
  } finally {
    finished = true;
    if (timer) dependencies.clearTimeout(timer);
    socket?.destroy();
    transporter.close();
  }
}
