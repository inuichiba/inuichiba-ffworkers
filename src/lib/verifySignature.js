// lib/verifySignature.js

/**
 * LINEのX-Line-Signatureを検証する関数（Cloudflare Workers専用）
 * @param {Request} request - fetchイベントで渡されるHTTPリクエスト
 * @param {string} channelSecret - LINEチャネルシークレット
 * @returns {Promise<{ isValid: boolean, bodyText: string }>}
 */
export async function verifySignature(request, channelSecret) {
  const signature = request.headers.get("x-line-signature");
  if (!signature) return { isValid: false, bodyText: "" };

  // 🔧 生のボディを「同時に」テキストとUint8Arrayで使えるようにする
  const bodyText = await request.text();
  const encoder = new TextEncoder();
  const bodyUint8Array = encoder.encode(bodyText); // ← textをHMAC対象に

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, bodyUint8Array);
  const computedSignature = toBase64(signatureBuffer);

  const isValid = signature === computedSignature;
  return { isValid, bodyText };
}

function toBase64(buffer) {
  const uint8Array = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}
