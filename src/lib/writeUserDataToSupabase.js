import { getEnv } from"./env.js";
import { getFormattedJST } from "./saveUserInfo.js";

/**
 * Supabase にユーザーデータを書き込む（Cloudflare対応）
 * @param {object} userData - ユーザーデータ
 * @param {object} env - 環境変数（supabaseUrl, supabaseKey を含む）
 */
export async function writeUserDataToSupabase(userData, env) {
  const { isProd, supabaseUrl, supabaseKey, usersTable } = getEnv(env);

  const {
    timestamp,
    groupId,
    userId,
    displayName,
    pictureUrl,
    statusMessage,
    shopName,
    inputData
  } = userData;

  // ユニークキーとして使う KV キー（例: "default_U061b67..."）
  const kvKey = `${groupId}_${userId}`;

  if (!isProd) {
    // console.trace("📌 writeUserDataToSupabase() が呼ばれました(トレース)");
    console.log("🕐 Supabase 書き込み開始タイムスタンプ:", timestamp);
    console.log("📦 Supabase 書き込みデータ:", userData);
    console.log("🔑 KV キー:", kvKey);
  }

  try {

    // ✅ 1. KVに該当キーが存在するか確認（TTL内の書き込み済みかどうか）
    const existing = await env.users_kv.get(kvKey);
    if (existing) {
      if (!isProd) console.log("⚠️ KV により Supabase 書き込みスキップ(正常終了):", kvKey);
      return { skipped: true };
    }

    // ✅ 2.Supabase にpost (upsert)（同一キーがあると409が返る）
    const postUrl = `${supabaseUrl}/rest/v1/${usersTable}?on_conflict=groupId,userId`;
    const headers = {
      "Content-Type": "application/json",
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Prefer": isProd
        ? "resolution=ignore-duplicates,return=minimal" // ✅ 重複があっても無視してレスポンス最小化
        : "resolution=merge-duplicates,return=representation",  // 開発中は更新を許可
    };

    const body = JSON.stringify(userData);
    const upsertRes = await fetch(postUrl, { method: "POST", headers, body });

    // レスポンスの内容をJSONまたはTEXTで取得
    let upsertResult;
    try {
      upsertResult = await upsertRes.clone().json();
    } catch {
      upsertResult = await upsertRes.text(); // fallback
    }

    // ✅ 3. 書き込み失敗時（409やその他）
    if (!upsertRes.ok) {
      // ✅ 特別処理：409 Conflict（ユニークキー重複＝KV TTL切れ or Cloudflare障害）
      if (upsertRes.status === 409 && isProd) {
        // このメッセージは出す方向で
        console.warn("⚠️ Supabaseに既存データがあり、KVは消失またはTTL切れでした:", kvKey);
        try {
          // KVに再保存して今後1年間スキップ対象にする
          await env.users_kv.put(kvKey, "1", { expirationTtl: 60 * 60 * 24 * 365 });
        } catch (kvErr) {
          console.error("⚠️ KVへの再登録に失敗:",  kvErr);
          // 処理は続ける（止めない）
        }
        // ✅ 重複があったが正常スキップとして処理
        return { skipped: true };
      }
      // ✅ 本当に失敗（本番409以外 or 開発環境）
      console.error("❌ Supabase 書き込み失敗:", {
        status: upsertRes.status,
        statusText: upsertRes.statusText,
        body: upsertResult,
      });
      return { error: upsertResult };
    }

    // ✅ 4. Supabase書き込み成功 → KVにも記録して次回以降スキップ
    const ttl = isProd ? 60 * 60 * 24 * 365 : 600; // 秒: 本番は1年、開発は600秒
    try {
      await env.users_kv.put(kvKey, "1", { expirationTtl: ttl });
    } catch(kvErr) {
      console.error("❌ Supabase 書き込みは成功したが、KV保存に失敗:", kvErr);
      // 書き込みは成功してるので止めない
    }

    if (!isProd) {
	    console.log("🕐 Supabase 書き込み完了タイムスタンプ:", getFormattedJST());
      console.log("✅ Supabase 書き込み成功");
    }

    return { success: true }; // ✅ 正常終了

  } catch (err) {
    // 💥 通信エラー・fetch失敗など
    console.error("❌ Supabase の書き込み中か KV 処理中に例外が発生しました：", err.stack || err);
    return { error: err };
  }

}

