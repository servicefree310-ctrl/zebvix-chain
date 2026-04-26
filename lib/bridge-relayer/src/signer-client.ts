import type { MintRequest } from "./eip712.ts";
import type { Logger } from "pino";

export interface SignerResponse {
  signer: string;
  signature: string;
  signedAt: number;
}

/**
 * Request a signature from a single validator's signer service.
 * Throws on HTTP error, timeout, or validation failure.
 */
export async function requestSignature(
  endpoint: string,
  req: MintRequest,
  timeoutMs: number,
  log: Logger,
  authToken?: string,
): Promise<SignerResponse> {
  const url = endpoint.replace(/\/$/, "") + "/sign-mint";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = {
      sourceTxHash: req.sourceTxHash,
      recipient: req.recipient,
      amount: req.amount.toString(),
      sourceChainId: req.sourceChainId.toString(),
      sourceBlockHeight: req.sourceBlockHeight.toString(),
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`signer ${endpoint} returned ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as Partial<SignerResponse> & { error?: string };
    if (json.error) throw new Error(`signer ${endpoint} rejected: ${json.error}`);
    if (!json.signature || !json.signer) {
      throw new Error(`signer ${endpoint} returned incomplete response`);
    }
    log.debug({ endpoint, signer: json.signer }, "got signature");
    return {
      signer: json.signer,
      signature: json.signature,
      signedAt: json.signedAt ?? Date.now(),
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Collect signatures in parallel from all configured signers, returning the
 * first M unique successful responses.
 */
export async function collectSignatures(
  endpoints: string[],
  req: MintRequest,
  threshold: number,
  timeoutMs: number,
  log: Logger,
  authToken?: string,
): Promise<{ signatures: string[]; signers: string[]; failures: { endpoint: string; error: string }[] }> {
  const promises = endpoints.map((ep) =>
    requestSignature(ep, req, timeoutMs, log, authToken)
      .then((r) => ({ ok: true as const, endpoint: ep, response: r }))
      .catch((e: unknown) => ({
        ok: false as const,
        endpoint: ep,
        error: e instanceof Error ? e.message : String(e),
      })),
  );
  const results = await Promise.all(promises);

  const signatures: string[] = [];
  const signers: string[] = [];
  const failures: { endpoint: string; error: string }[] = [];
  const seenSigners = new Set<string>();

  for (const r of results) {
    if (r.ok) {
      const lower = r.response.signer.toLowerCase();
      if (!seenSigners.has(lower)) {
        seenSigners.add(lower);
        signatures.push(r.response.signature);
        signers.push(r.response.signer);
      }
    } else {
      failures.push({ endpoint: r.endpoint, error: r.error });
    }
  }

  if (signatures.length < threshold) {
    throw new Error(
      `collected only ${signatures.length}/${threshold} signatures (failures: ${
        failures.map((f) => `${f.endpoint}: ${f.error}`).join("; ") || "none"
      })`,
    );
  }
  // Trim to exactly threshold (saves gas).
  return {
    signatures: signatures.slice(0, threshold),
    signers: signers.slice(0, threshold),
    failures,
  };
}
