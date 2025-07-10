
import { getEnv } from "./lib/env.js";
import { handleEvent } from "./handlers/events.js"; // ← 🔧 これがCloudflare対応済ならOK
import { verifySignature } from "./lib/verifySignature.js";
import { onRequestPost as handleNotify } from './notify.js';

export default {
  async fetch(request, env, ctx) {
		const { isProd, channelSecret } = getEnv(env);
		const url = new URL(request.url);

	  // ✅ /notify エンドポイントの処理（GitHub Actions用）
    if (request.method === "POST" && url.pathname === "/notify") {
      return handleNotify({ request, env, ctx });
    }

	  // ✅ Webhookの GET ヘルスチェック
    if (request.method === "GET") {
      if (!isProd) console.log("📶 Webhook Healthcheck に応答");
      return new Response("Webhook is alive", { status: 200 });
    }

    // ✅ その他のメソッドは拒否
	  if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 自作ミドルウェアで署名検証（Cloudflare版は自前実装または簡略化が必要）
	  const { isValid, bodyText } = await verifySignature(request, channelSecret);
	  if (!isValid) {
//    const signature = request.headers.get("x-line-signature");  //評価終了時削除！！
			if (!isProd) console.warn("⚠️ LINE署名検証失敗");
/**
      //評価終了時削除！！
      console.warn("🔐 署名ヘッダ:", signature?.slice(0, 10), "...");
      console.warn("🔐 channelSecret:", channelSecret?.slice(0, 5), "...");
      console.warn("📦 bodyText先頭:", bodyText.slice(0, 30));
*/
  		return new Response("Unauthorized", { status: 401 });
		}

    // イベント解析と処理(JSONパース)
		let json;
		try {
  		json = JSON.parse(bodyText);
		} catch (err) {
  		console.error("❌ JSON解析エラー:", err);
  		return new Response("Invalid JSON", { status: 400 });
		}

		if (!json.events || !Array.isArray(json.events)) {
  		return new Response("Invalid event format", { status: 400 });
		}

    // ✅ 各イベント処理（失敗しても継続）
		for (let i = 0; i < json.events.length; i++) {
  		const event = json.events[i];
  		try {
    		await handleEvent(event, env);
  		} catch (err) {
    		console.error("❌ handleEvent エラー:", err);
				// たくさんのイベント処理をする中、1件エラーになったら終わっちゃまずいので
				// ここではエラーリターンはせずイベント処理のループを続ける
  		}
		}

		return new Response("OK", { status: 200 });

	}

};
