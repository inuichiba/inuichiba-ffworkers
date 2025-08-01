// lib/sbWriter.js
import { getEnv } from"./env.js";
import { getFormattedJST } from "./saveUserInfo.js";
import { addMonthCount, getUTCDateString } from "./kvUtils.js";

/**
 * Supabase にユーザーデータを書き込む（Cloudflare対応）
 * @param {object} userData - ユーザーデータ
 * @param {object} env - 環境変数（supabaseUrl, supabaseKey を含む）
 */
export async function writeToSb(userData, env) {
  const { isProd, supabaseUrl, supabaseKey, usersTable, usersKV } = getEnv(env);
  const { timestamp, groupId, userId } = userData;
  // ユーザー識別用の KV キー（例: "default_U061b67..."）
  const kvKey = `${groupId}_${userId}`;
  // Supabase月次フラグ → supabase_flag:ffprod:2025-07 形式(日時はUTC)
  const sbFlagKey = `supabase_flag:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString().slice(0, 7)}`;

  if (!isProd) {
    console.log("🕐 Supabase 書き込み開始タイムスタンプ:", timestamp);
    console.log("📦 Supabase 書き込みデータ:", userData);
    console.log("🔑 KV キー:", kvKey);
  }

  try {
    // ✅ 0. Supabaseフラグを確認（書き込みが閾値を超えていたら書き込まずリターン）
    const sbFlag = await usersKV.get(sbFlagKey);
    if (sbFlag === "threshold") {
      if (!isProd) console.warn("⚠️ Supabase月次書き込みフラグ threshold によりスキップ");
      return { skipped: true };
    }

    // ✅ 1. KVに該当キーが存在するか確認（TTL内の書き込み済みかどうか）
    const existing = await usersKV.get(kvKey);
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
        ? "resolution=ignore-duplicates,return=representation" // 重複があったら Supabase 側が明確に「insertできたか、重複で無視されたか」を返す
        : "resolution=merge-duplicates,return=representation", // 開発環境は更新を許可
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


    // ✅ 書き込み成功だがレスポンス空配列 → 重複とみなしてKV補完
    if (isProd && Array.isArray(upsertResult) && upsertResult.length === 0) {
      // ffprodのことなので必ずコンソールに出力する
      console.warn("⚠️ Supabase重複により何も書き込まれなかった → KVを補完:", kvKey);
      await usersKV.put(kvKey, "1", { expirationTtl: 60 * 60 * 24 * 365 });

      // ✅ 明示ログ追加
      console.log("📌 Supabase空配列時の月次件数加算を実施します");
      await addMonthCount(env);
      return { skipped: true };
    }

    // ✅ 3. 書き込み失敗時（409や500など）
    if (!upsertRes.ok) {
      // ✅ 特別処理：409 Conflict（ユニークキー重複＝KV TTL切れ or Cloudflare障害）
      if (upsertRes.status === 409 && isProd) {
        // このメッセージは出す方向で
        console.warn("⚠️ Supabaseに既存データがあり、KVは消失またはTTL切れでした:", kvKey);

        // KVに再保存して今後1年間スキップ対象にする
        await usersKV.put(kvKey, "1", { expirationTtl: 60 * 60 * 24 * 365 });
        await addMonthCount(env);

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
    await usersKV.put(kvKey, "1", { expirationTtl: ttl });
    if (!isProd) console.log("📌 KVへの保存成功:", kvKey);

    try {
      if (!isProd) console.log("📌 月次カウント加算処理を開始");
      await addMonthCount(env);
    } catch (err) {
      if (!isProd) console.warn("⚠️ 月次カウント処理で例外:", err);
    }

    if (!isProd) {
	    console.log("🕐 Supabase 書き込み完了タイムスタンプ:", getFormattedJST());
      console.log("✅ Supabase 書き込み成功");
    }

    return { success: true }; // ✅ 正常終了

  } catch (err) {
    // 💥 通信エラー・fetch失敗など
    console.error("❌ Supabase の書き込み中に例外が発生しました：", err.stack || err);
    return { error: err };
  }
}


