
import { getEnv } from "./lib/env.js";
import { handleEvent } from "./handlers/events.js"; // ← 🔧 これがCloudflare対応済ならOK
import { verifySignature } from "./lib/verifySignature.js";

export default {
  async fetch(request, env, ctx) {
		const { isProd, channelSecret } = getEnv(env);
		
    if (request.method === "GET") {
      if (!isProd) console.log("📶 Webhook Healthcheck に応答");
      return new Response("Webhook is alive", { status: 200 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 自作ミドルウェアで署名検証（Cloudflare版は自前実装または簡略化が必要）
		const { isValid, bodyText } = await verifySignature(request, channelSecret);
		if (!isValid) {
			if (!isProd) console.warn("⚠️ LINE署名検証失敗");
  		return new Response("Unauthorized", { status: 401 });
		}
		
    // イベント解析と処理
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