// lib/verifySignature.js

/**
 * LINEのX-Line-Signatureを検証する関数（Cloudflare Workers専用）
 * @param {Request} request - fetchイベントで渡されるHTTPリクエスト
 * @param {string} channelSecret - LINEチャネルシークレット
 * @returns {Promise<{ isValid: boolean, bodyText: string }>}
 */
export async function verifySignature(request, channelSecret) {
  // リクエストヘッダーから署名を取得
  const signature = request.headers.get("x-line-signature");
  if (!signature) return { isValid: false, bodyText: "" };

  // ボディの生データを取得（Bufferとして）
  const bodyBuffer = await request.arrayBuffer();
  const bodyText = new TextDecoder().decode(bodyBuffer);

  // HMAC-SHA256で署名を計算
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(bodyText));
  const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  // LINEの署名と比較（タイミング攻撃対策として定数時間比較が理想だが、Cloudflareは難しい）
  const isValid = signature === computedSignature;

  return { isValid, bodyText };
}
