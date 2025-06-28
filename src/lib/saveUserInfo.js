// lib/saveUserInfo.js
import { getUserProfile } from './lineApiHelpers.js';
import { writeUserDataToSupabase } from './writeUserDataToSupabase.js';
import { getEnv } from"./env.js";


// ✅ 日本時間のタイムスタンプ（先頭0なしのH形式）
export function getFormattedJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, '0');
  const dd = String(jst.getDate()).padStart(2, '0');
  const h = jst.getHours();
  const mi = String(jst.getMinutes()).padStart(2, '0');
  const ss = String(jst.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${h}:${mi}:${ss}`;
}


/**
 * Supabase にユーザーデータを書き込む（ffprod=初回のみ、ffdev=毎回上書き）
 * @param {object} userId - Supabase に保存するキーのひとつ
 * @param {object} groupId - Supabase に保存するキーのひとつ
 * @param {object} env - 環境変数（supabaseUrl, supabaseKey を含む）
 */
export async function saveUserProfileAndWrite(userId, groupId, env) {
  const { isProd } = getEnv(env);

  const profile = await getUserProfile(userId, env);
 	// プロフィールが取れない場合は書き込まない(ブロックや未followなどがあるため)
	// LINEチャネル設定ミス可能性も有(アクセストークンのスコープにPROFILE権限がない)
	if (!profile) {
    // profileがnull のためスキップ（本番では例外にしない）
		if (!isProd) console.warn("⚠️ ユーザープロフィール情報の取得に失敗（null）:", { userId, groupId });
		return { error: "user Profile 取得に失敗" };
	}
		
  const displayName   = profile?.displayName   || null;
  const pictureUrl    = profile?.pictureUrl    || null;
  const statusMessage = profile?.statusMessage || null;
  const timestamp = getFormattedJST();
  groupId = groupId ?? "default";
  const shopName  = null;  // inputData とともに将来機能のため現在は null を送信
  const inputData = null;
  
  try {
    const result = await writeUserDataToSupabase({
      timestamp,
      groupId,
      userId,
      displayName,
      pictureUrl,
      statusMessage,
      shopName,
      inputData
    }, env);

   // await delAndPutKV("all", "U4f4509e648b3cb14cfe8c9a14a4eade9", null, "60", env);
  
   // コンソールログは writeUserDataToSupabase() が出してるので出さない 
    if (result?.skipped) {
      // if (!isProd) console.log("⚠️ KVによりSupabase書き込みスキップ");
      // return new Response("SKIPPED", { status: 200 });
      return { skipped: true };
    }

    if (result?.error) {
      // if (!isProd) console.error("❌ Supabaseへの書き込み失敗:", result.error);
      // エラー通知や再試行判定
      // return new Response("ERROR", { status: 500 });
      return { error: result?.error };
    }

    // 成功時
    // if (!isProd) console.log("✅ Supabase書き込み成功");
    // return new Response("OK", { status: 200 });
    return { success: true };
  
  } catch (err) {
    console.error("💥 Supabase KV または書き込み処理中に例外:", err);
    // return new Response("ERROR", { status: 500 });
   return { error: err };
  }
}


/**
 * KVの追加、削除処理
 * @param {object} KVKind - 必須。"put"(追加) or "del"(削除) or "all"(どちらも)
 * @param {object} userId - 必須。Supabase に保存するキーのひとつ
 * @param {object} groupId - nullだったら"default"とみなされる
 * @param {object} ttl - 何秒後に削除するか。nullだったら600秒。"del"の時は不要
 * @param {object} env - 環境変数（supabaseUrl, supabaseKey を含む）
 */
async function delAndPutKV(KVKind, userId, groupId, ttl, env) {
  const users_kv = env.users_kv;
  groupId = groupId ?? "default";
  
  if (!userId) {
    console.warn("⚠️ userId が未定義です");
    return { error: "userId is not defined" };
  }

  const kvKey = `${groupId}_${userId}`;

  if (KVKind == "del" || KVKind == "all") {
    try {
      const existing = await env.users_kv.get(kvKey);
      if (!existing) {
        console.log("🟡 KVキーは既に存在しません:", kvKey);
      } else {         
        await users_kv.delete(kvKey);
        console.log("🗑️ KVキーを削除しました:", kvKey);
      }
    } catch (err) {
      console.error("❌ KV削除失敗:", err);
    }
  } 

  if (KVKind == "put" || KVKind == "all") {
    const timestamp = getFormattedJST();
    if (!ttl) ttl = 600;
    const value = JSON.stringify({ "writtenAt": timestamp, "TTL": ttl, "source": "LINE_BOT", "note": "first write" });
    try {
      await users_kv.put(kvKey, value, { expirationTtl: ttl }); // TTLは開発用
      console.log(`✅ KV に書き込み成功: kvKey=${kvKey}, TTL=${ttl}`);
    } catch (err) {
      console.error("❌ KV 書き込み失敗:", err);
    }
  }

}
