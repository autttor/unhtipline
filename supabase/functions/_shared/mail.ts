// Mail delivery. One provider (Resend) plus a sandbox that never sends anything.
// There is deliberately no fallback chain: if the configured provider fails, the notification stays
// in the outbox, is retried, and is shown to admins as failed.

export type Mail = { to: string; from: string; subject: string; text: string; idempotencyKey: string };
export type MailProvider = { name: string; send: (mail: Mail) => Promise<{ id: string }> };

/** category is one of: auth, invalid_request, rate_limited, provider_error, network, not_configured */
export class MailError extends Error {
  category: string;
  constructor(category: string, message: string) {
    super(message);
    this.category = category;
  }
}

function categoryFor(status: number): string {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid_request";
  return "provider_error";
}

export function resendProvider(apiKey: string, fetchImpl: typeof fetch = fetch): MailProvider {
  return {
    name: "resend",
    async send(mail) {
      let res: Response;
      try {
        res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // Lets the provider drop an accidental repeat of the same notification.
            "Idempotency-Key": mail.idempotencyKey,
          },
          body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text }),
        });
      } catch (e) {
        throw new MailError("network", String(e));
      }
      if (!res.ok) throw new MailError(categoryFor(res.status), `Resend answered ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return { id: typeof data.id === "string" ? data.id : "" };
    },
  };
}

/** For local runs and tests: records what would have been sent and never contacts anyone. */
export function sandboxProvider(sent: Mail[] = []): MailProvider & { sent: Mail[] } {
  return {
    name: "sandbox",
    sent,
    send(mail) {
      sent.push(mail);
      return Promise.resolve({ id: `sandbox-${sent.length}` });
    },
  };
}
