
import { handleEvent } from "./handlers/events.js"; // 🔧 各イベントごとの処理（Promiseを返す）
import { saveUserInfo } from "./lib/saveUserInfo.js";
import { verifySignature } from "./lib/verifySignature.js";
import { incrementKVReadCount } from "./lib/kvUtils.js";
import { onRequestPost as handleNotify } from './notify.js';
import { getEnv } from "./lib/env.js";


export default {
  async fetch(request, env, ctx) {
    const { isProd } = getEnv(env);

    // URL情報を取得
    const url = new URL(request.url);
    // HTTPメソッドとパスをまとめたルート名を作成
    var route = request.method + " " + url.pathname;

    // ここからAPIの分岐！
    switch (route) {
      case "POST /":  // ← ここが「LINEのWebhook」受信用
        return handleWebhook(request, env, ctx);

      case "POST /notify":
        // /notify エンドポイント（GitHub Actions用：ココ使うと課金されるよ）
        return handleNotify({ request, env, ctx });

      case "GET /":
        // ヘルスチェック（GETだけOK）
        if (!isProd) console.log("📶 Webhook Healthcheck に応答");
        return new Response("Webhook is alive", { status: 200 });

      default:
        // それ以外（該当なし）は404エラーで返す
        return new Response("Not found", { status: 404 });
    }
  }
};


// LINEのWEBHOOKの処理
async function handleWebhook(request, env, ctx) {
		const { isProd, channelSecret } = getEnv(env);

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

    // ✅ 各イベントを非同期に実行（裏で投げる）
		for (let i = 0; i < json.events.length; i++) {
  		const event = json.events[i];
  		try {
        // 1. 計測に関係するカウントは裏へ(1イベントごとに日次件数を1回加算)
        ctx.waitUntil(incrementKVReadCount(env).catch(function (err) {
          if (!isProd) console.warn("KV日次フラグON/Discord通知処理エラー:", err);
        }));

        // 2. 返信を含む処理はここだけ await（reply を確実に終わらせる）
        await handleEvent(event, env, ctx);

        // 3. 重い保存系は裏へ
        // 対象イベントのみ Supabase + KV に保存（裏で非同期処理）
        const types = ['postback', 'follow', 'message'];  // Supabase,KV書き込み対象イベント
        if (types.includes(event.type)) {                 // イベントの種類がtypesと同じだったら
          // 非同期処理を裏に投げる
          ctx.waitUntil(saveUserInfo(event, env).catch(function (err) {
            if (!isProd) console.warn(`${event.type} eventでSupabaseアクセスエラー:`, err);
          }));
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

