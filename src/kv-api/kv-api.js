// 📁 kv-api.js
// Cloudflare Workers にデプロイする KV 操作用 API エンドポイント
// POST リクエストで KV に del / put / all 操作を行う
// Cloudflare Workers の Secret に KV_API_TOKEN_PROD|KV_API_TOKEN_DEV を登録しておくこと
//
/**

🔧 デプロイ方法(Windows)
cd D:\nasubi\inuichiba-ffworkers\src\kv-api
npx wrangler deploy --env ffprod --config wrangler.kvapi.toml
npx wrangler deploy --env ffdev  --config wrangler.kvapi.toml

🔧 デプロイ方法(Mac：Terminal.app つまりターミナルから)
cd /users/nasubi810/nasubi/inuichiba-ffworkers/src/kv-api とか？
cd ~/projecrName(nasubiとか？)/inuichiba-ffworkers/src/kv-api
npx wrangler deploy --env ffprod --config wrangler.kvapi.toml
npx wrangler deploy --env ffdev  --config wrangler.kvapi.toml

*/
//
// 🔧 使用方法:
// デプロイ先URL（例）: https://inuichiba-ffworkers-kvapi-ffprod.<your-worker-name>.workers.dev
// POSTリクエストで以下のJSONを送信:
//     {
//       "kind": "put"|"del"|"all"|"groupdel", // put:書き込み del:削除 all:del→put groupdel:Cで始まるグループラインを500件削除
//       "userId": "Uxxxx...",       // kind==groupdel以外必須
//       "groupId": "default"        // 任意。省略すると"default"になる。kind==groupdelは省略不可
//       "ttl": 600                  // 任意。省略時は600秒
//       "env": "ffprod" | "ffdev"   // 任意。省略時は "ffprod"
//     }
//
//
// 🔧 put と all の違い
// 通常は PUT(値が残ってても知らん顔して上書き)で十分
// でも「明示的な初期化」「壊れたときの再登録」「登録の失敗リカバリ」には all（delしてputする）
//
/**

🍖 実行例(ffprodの例：Windows) ※.batを使用して、curl.exeを使用すること
cd D:\nasubi\inuichiba-ffworkers\src\kv-api
.\kvapi-curl-ffdev.bat
.\kvapi-curl-ffprod.bat

🍖 実行例(ffdevの例：Mac) ※ターミナルから実行
🍖 初回だけ
cd ~/nasubi/inuichiba-ffworkers/src/kv-api
chmod +x kv-api-curl-ffdev.sh
chmod +x kv-api-curl-ffprod.sh

🍖 実行
cd ~/nasubi/inuichiba-ffworkers/src/kv-api
./kv-api-curl-ffdev.sh
./kv-api-curl-ffprod.sh

*/
//
// 🔧 参考
// U4f4509e648b3cb14cfe8c9a14a4eade9 … ffdev での私のユーザーId
// U061b67a5098093dfcbae373c2e7db1ea … ffprodでの私のユーザーId
//
// Uea8d4a145bff6700045c2b263927d844 … ffdev でのNASUBIのユーザーId
// U21edb08eec2c77590f64ac947ec6d820 … ffprodでのNASUBIのユーザーId
//
//
// 💡 curl は macOS に標準搭載されています（追加インストール不要）
//  もし見つからなかった（which curl で出てこない）とき、以下でインストールしてくだいさい（まれ）
//  brew install curl


import { getEnv } from "../lib/env.js";

/**
 * POSTされたリクエストを処理し、KVを操作します
 * @param {Request} request - POSTされたリクエスト（JSON）
 * @param {object} env - Cloudflare Workers の環境変数
 * @returns {Response} 結果のレスポンス
 */
export async function handleKVToolRequest(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { usersKV, kvApiToken } = getEnv(env);

  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (token !== kvApiToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const kind = body.kind;
    const userId = body.userId;
    const ttl = body.ttlArg ?? 600;
    // groupIdは扱い方が変わるのでここでは触れない

    // ✅ groupdel 専用処理（他の処理より前に--userId不要だから）
    if (kind === "groupdel") {
      const groupId = body.groupId;
      if (!groupId) {
        return new Response("Missing groupId for groupdel", { status: 400 });
      }
      const prefix = groupId;
      const list = await usersKV.list({ prefix });
      let count = 0;
      for (let i = 0; i < list.keys.length; i++) {
        const key = list.keys[i].name;
        if (key.startsWith(groupId) && count < 500) {
          await usersKV.delete(key);
          count++;
        }
      }
      console.log(`🗑️ groupId="${groupId}" で ${count} 件削除しました`);
      return new Response(`Deleted ${count} keys`, { status: 200 });
    }


    // ✅ 通常のキー（userId 必須）処理
    if (!userId || !kind) {
      return new Response("Missing userId or kind", { status: 400 });
    }
    const groupId = body.groupId || "default";
    const kvKey = groupId + "_" + userId;
    const KV_SENTINEL = "1";


    if (kind === "del" || kind === "all") {
      const existing = await usersKV.get(kvKey);
      if (existing) {
        await usersKV.delete(kvKey);
        console.log("🗑️ KVキーを削除しました:", kvKey);
      } else {
        console.log("⚠️ KVキーは存在しません:", kvKey);
      }
    }


    if (kind === "put" || kind === "all") {
      const kvValue = KV_SENTINEL;
      await usersKV.put(kvKey, kvValue, { expirationTtl: ttl});
      console.log(`✅ KVキーを追加しました: ${kvKey}, ttl=${ttl}秒`);
    }

    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("❌ JSONパースまたはKV操作に失敗しました:", err);
    return new Response("Internal Error", { status: 500 });
  }
}

// Cloudflare Workers の fetch ハンドラー
export default {
  async fetch(request, env) {
    return await handleKVToolRequest(request, env);
  }
};


