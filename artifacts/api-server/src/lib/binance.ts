import crypto from "crypto";
import https from "https";
import { logger } from "./logger";

const BASE_URL = "https://testnet.binancefuture.com";
const TIMEOUT_MS = 10_000;

export class BinanceAPIError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "BinanceAPIError";
  }
}

function sign(secret: string, params: Record<string, string | number>): Record<string, string | number> {
  const withTs = { ...params, timestamp: Date.now() };
  const qs = new URLSearchParams(
    Object.entries(withTs).map(([k, v]) => [k, String(v)])
  ).toString();
  const sig = crypto.createHmac("sha256", secret).update(qs).digest("hex");
  return { ...withTs, signature: sig };
}

function httpsRequest(
  method: string,
  path: string,
  params: Record<string, string | number>,
  apiKey: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();

    const isGet = method === "GET";
    const fullPath = isGet ? `${path}?${qs}` : path;
    const body = isGet ? undefined : qs;

    const options: https.RequestOptions = {
      hostname: "testnet.binancefuture.com",
      path: fullPath,
      method,
      headers: {
        "X-MBX-APIKEY": apiKey,
        ...(isGet
          ? {}
          : { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body!) }),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed === "object" && "code" in parsed && typeof parsed.code === "number" && parsed.code < 0) {
            reject(new BinanceAPIError(parsed.code, parsed.msg ?? "Unknown Binance error"));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Non-JSON response from Binance: ${data.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Request to Binance timed out after ${TIMEOUT_MS}ms`));
    });

    req.on("error", (err) => reject(new Error(`Network error: ${err.message}`)));

    if (body) req.write(body);
    req.end();
  });
}

export function getCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = process.env["BINANCE_API_KEY"];
  const apiSecret = process.env["BINANCE_API_SECRET"];
  if (!apiKey || !apiSecret) {
    throw new Error(
      "BINANCE_API_KEY and BINANCE_API_SECRET environment variables must be set."
    );
  }
  return { apiKey, apiSecret };
}

export async function binancePost(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  const { apiKey, apiSecret } = getCredentials();
  const signed = sign(apiSecret, params);
  logger.info({ endpoint, params: { ...params } }, "Binance POST request");
  const result = await httpsRequest("POST", endpoint, signed, apiKey);
  logger.info({ endpoint }, "Binance POST response OK");
  return result;
}

export async function binanceGet(
  endpoint: string,
  params: Record<string, string | number> = {},
): Promise<unknown> {
  const { apiKey, apiSecret } = getCredentials();
  const signed = sign(apiSecret, params);
  logger.info({ endpoint }, "Binance GET request");
  const result = await httpsRequest("GET", endpoint, signed, apiKey);
  logger.info({ endpoint }, "Binance GET response OK");
  return result;
}

export { BASE_URL };
