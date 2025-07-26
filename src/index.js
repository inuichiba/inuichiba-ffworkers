
import { handleEvent } from "./handlers/events.js"; // 🔧 各イベントごとの処理（Promiseを返す）
import { saveUserInfo } from "./lib/saveUserInfo.js";
import { verifySignature } from "./lib/verifySignature.js";
import { incrementKVReadCount } from "./lib/kvUtils.js";
import { onRequestPost as handleNotify } from './notify.js';
import { getEnv } from "./lib/env.js";

export default {
  async fetch(request, env, ctx) {
		const { isProd, channelSecret } = getEnv(env);
 		const url = new URL(request.url);
	  // ✅ /notify エンドポイントの処理（GitHub Actions用：ココ使うと課金されるよ）
    if (request.method === "POST" && url.pathname === "/notify") {
      return handleNotify({ request, env, ctx });
    }

	  // ✅ Webhookの GETリクエストはヘルスチェックとして返答
    // 要するに「元気？生きてる？」って聞きたくなる時あるよね？
    // そう聞いたら「元気だよ」って答えるときの処理
    // だからそれ以上の処理はやらない
    if (request.method === "GET") {
      if (!isProd) console.log("📶 Webhook Healthcheck に応答");
      return new Response("Webhook is alive", { status: 200 });
    }

    // ✅ その他のメソッド（PUTなど）は拒否
	  if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 自作ミドルウェアでLINEの署名検証（Cloudflare版は自前実装または簡略化が必要）
    // （不正なリクエストは拒否）
	  const { isValid, bodyText } = await verifySignature(request, channelSecret);
	  if (!isValid) {
			if (!isProd) console.warn("⚠️ LINE署名検証失敗");
  		return new Response("Unauthorized", { status: 401 });
		}

    // Webhook JSON の解析：イベント解析と処理(JSONパース)
		let json;
		try {
  		json = JSON.parse(bodyText);
		} catch (err) {
  		console.error("❌ JSON解析エラー:", err);
  		return new Response("Invalid JSON", { status: 400 });
		}

		// ✅ イベント配列がなければエラー
    if (!json.events || !Array.isArray(json.events)) {
  		return new Response("Invalid event format", { status: 400 });
		}

    // ✅ 各イベントを非同期に裏で実行（ctx.waitUntil）
		for (let i = 0; i < json.events.length; i++) {
  		const event = json.events[i];
  		try {
        // ✅ 1イベントごとに日次件数を1回加算
        await incrementKVReadCount(env);

        // 🔄 非同期で裏に処理を投げる（Supabase書き込みだけ時間がかかるので非同期）
        // ユーザーには返却処理ができた時点で返す。Supabase処理がおゎるまで待たない
        handleEvent(event, env);  // awaitなしで即返しOK

        // 対象イベントのみ Supabase + KV に保存（裏で非同期処理）
        const types = ['postback', 'follow', 'message'];  // Supabase,KV書き込み対象イベント
        if (types.includes(event.type)) {                 // イベントの種類がtypesと同じだったら
          ctx.waitUntil(saveUserInfo(event, env));        // 非同期処理を裏に投げる
        }
  		} catch (err) {
    		console.error("❌ handleEvent エラー:", err);
        // ここでエラーを返すと他のイベント処理が止まるので無視して続行
        // 10件処理を待たせてるのに1件目でエラーだよって処理が止まったら
        // 残りの9件が大変なことになるからね
      }
		}

		// ✅ 即時レスポンス（Supabase完了を待たずに返す。ユーザーを待たせない）
    // 非同期にしたから処理自体はいつもOK(詳細な結果はコンソールログに出る）
    // エラー処理やSupabaseの結果が知りたければログで確認すること
    return new Response("OK", { status: 200 });
	}
};
