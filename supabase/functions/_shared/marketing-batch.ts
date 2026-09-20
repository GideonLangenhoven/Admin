const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = ["example", "invalid", "localhost", "test"];

export function marketingEmailValidationError(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return "Invalid recipient email address";

  const domain = normalized.slice(normalized.lastIndexOf("@") + 1).replace(/\.$/, "");
  if (
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith("." + reserved)) ||
    RESERVED_TLDS.some((tld) => domain === tld || domain.endsWith("." + tld))
  ) {
    return "Reserved/test recipient domain: " + domain;
  }

  return null;
}

export function parseResendBatchResponse(body: unknown, batchSize: number): {
  sent: Array<{ index: number; emailId: string }>;
  failed: Array<{ index: number; error: string }>;
} | null {
  if (!body || typeof body !== "object") return null;

  const response = body as {
    data?: Array<{ id?: unknown }>;
    errors?: Array<{ index?: unknown; message?: unknown }>;
  };
  if (!Array.isArray(response.data)) return null;

  // Strict-mode success has no errors array and one ID per input. Permissive
  // mode compacts successful IDs and identifies failures by original index.
  if (response.errors === undefined) {
    if (response.data.length !== batchSize || response.data.some((item) => typeof item?.id !== "string")) return null;
    return {
      sent: response.data.map((item, index) => ({ index, emailId: item.id as string })),
      failed: [],
    };
  }

  if (!Array.isArray(response.errors)) return null;
  const failedIndexes = new Map<number, string>();
  for (const error of response.errors) {
    if (
      !Number.isInteger(error?.index) ||
      (error.index as number) < 0 ||
      (error.index as number) >= batchSize ||
      typeof error.message !== "string" ||
      failedIndexes.has(error.index as number)
    ) return null;
    failedIndexes.set(error.index as number, error.message);
  }

  if (
    response.data.length !== batchSize - failedIndexes.size ||
    response.data.some((item) => typeof item?.id !== "string")
  ) return null;

  const sent: Array<{ index: number; emailId: string }> = [];
  const failed: Array<{ index: number; error: string }> = [];
  let successIndex = 0;
  for (let index = 0; index < batchSize; index++) {
    const error = failedIndexes.get(index);
    if (error !== undefined) failed.push({ index, error });
    else sent.push({ index, emailId: response.data[successIndex++].id as string });
  }
  return { sent, failed };
}
