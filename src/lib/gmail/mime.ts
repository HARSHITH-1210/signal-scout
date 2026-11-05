// Builds an RFC 5322 plain-text message for the Gmail API's `raw` field.

/** Encodes a header value as an RFC 2047 encoded-word when it isn't plain ASCII. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** Strict enough to keep header injection out: one address, no display name, no line breaks. */
export function isSafeAddress(address: string): boolean {
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(address) && address.length <= 254;
}

/** Base64url without padding, as the Gmail API expects. */
export function base64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildRawMessage(message: { from: string; to: string; subject: string; body: string }): string {
  if (!isSafeAddress(message.to)) throw new Error("Recipient address is not valid.");
  if (!isSafeAddress(message.from)) throw new Error("Sender address is not valid.");
  const body = message.body.replace(/\r?\n/g, "\r\n");
  const lines = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    // base64 body wrapped at 76 characters per RFC 2045
    Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return base64Url(lines.join("\r\n"));
}
