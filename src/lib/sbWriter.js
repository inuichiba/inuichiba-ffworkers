// lib/sbWriter.js
import { getEnv } from"./env.js";
import { getFormattedJST } from "./getFormattedJST.js";
import { addMonthCount, getUTCDateString } from "./kvUtils.js";
// import { checkSbSum } from "./kvUtils.js";  開発凍結中

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

  try {
    // ✅ 0. Supabaseフラグを確認（書き込みが閾値を超えていたら書き込まずリターン）
    // Supabase月次フラグ → supabase_flag:ffprod:2025-07 形式(日時はUTC)
    const month = getUTCDateString().slice(0, 7);
    const sbFlagKey = `supabase_flag:${isProd ? "ffprod" : "ffdev"}:${month}`;
    // Supabase月次フラグがしきい値を超えていたら書き込まずにスキップ
    const sbFlag = await usersKV.get(sbFlagKey);
    if (typeof sbFlag === "string" && sbFlag === "threshold") {
      if (!isProd) console.warn(`[STEP 0-1] 🚫 ${isProd ? "ffprod" : "ffdev"}：Supabase書き込み停止中（90%超過）`);
      return { skipped: true };
    }


    // ✅ 1. KVに該当キーが存在するか確認（TTL内の書き込み済みかどうか）
    const existing = await usersKV.get(kvKey);
    if (existing) {
      if (!isProd) console.log("[STEP 1] ⚠️ ユーザーKVキー存在のためスキップ(正常終了):", kvKey);
      return { skipped: true };
    }


    // ここから始めて書き込みを始める
    if (!isProd) {
      console.log("🕐 [step/1-2] Supabase 書き込み開始 JST:", timestamp);
      console.log("📦 [step/1-3] Supabase 書き込みデータ:", userData);
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
      console.warn("[STEP 2-1] ⚠️ Supabase upsert 重複(空配列)のためKV補完:", kvKey);
      console.log("[STEP 2-2] 📌 Supabase月次件数を加算開始(空配列時)");
      // KVに保存、月次件数加算、ffprod/ffdev合算で90%で通知
      await saveAndNotify(env, kvKey, "2");
      return { skipped: true };
    }

    // ✅ 3. 書き込み失敗時（409や500など）
    if (!upsertRes.ok) {
      // ✅ 特別処理：409 Conflict（ユニークキー重複＝KV TTL切れ or Cloudflare障害）
      if (upsertRes.status === 409 && isProd) {
        // ここはffProdの処理だから、メッセージは全部出す
        console.warn("[STEP 3-1] ⚠️ Supabaseに既存データ、KVは消失 → KV補完:", kvKey);
        console.log("[STEP 3-2] 📌 月次件数の加算開始");

        // KVに保存、月次件数加算、ffprod/ffdev合算で90%で通知
        await saveAndNotify(env, kvKey, "3");

        // ✅ 重複があったが正常スキップとして処理
        return { skipped: true };
      }

      // ✅ 本当に失敗（本番409以外 or 開発環境）
      console.error("❌ [STEP 3-4] Supabase 書き込み失敗:", {
        status: upsertRes.status,
        statusText: upsertRes.statusText,
        body: upsertResult,
      });
      return { error: upsertResult };
    }

    // ✅ 4. Supabase書き込み成功 → KVにも記録して次回以降スキップ
    // ffprodは永続スキップ、ffdevは10分スキップ
    await saveAndNotify(env, kvKey, "4");

    if (!isProd) {
	    console.log("[STEP/5] 🕐 Supabase 書き込み完了 JST:", getFormattedJST());
    }

    return { success: true }; // ✅ 正常終了

  } catch (err) {
    // 💥 通信エラー・fetch失敗など
    console.error("[STEP 6] ❌ Supabase 書き込み中に例外発生：", err.stack || err);
    return { error: err };
  }
}


/**
 *  KVと月次件数加算＋合算通知を安全に処理する共通関数
 * @param {object} env - 環境変数（supabaseUrl, supabaseKey を含む）
 * @param {string} kvKey - ユーザー識別用KVキー
 * @param {string} logNo - コンソールログ識別番号
 */
async function saveAndNotify(env, kvKey, logNo) {
  const { isProd, usersKV } = getEnv(env);
  // ユーザーKVキーのValue。SENTINEL:特別な意味を持つ値のこと
  // この場合「このユーザーIDは Supabase に既に書き込まれたので、以後は再投稿させない」
  // という番人（sentinel）の役割 を "1" に持たせている
  const KV_SENTINEL = "1";

  try {
    if (isProd) {
      // ffprodの処理なのでログは全部出す
      await usersKV.put(kvKey, KV_SENTINEL);  // ユーザーKVキーもSupabase書き込みと同様永続
    } else {
      await usersKV.put(kvKey, KV_SENTINEL, { expirationTtl: 600 });  // 開発環境は10分
      console.log(`[STEP ${logNo}-1] 📌 KVへの保存成功(開発環境):`, kvKey);
    }

    console.log(`[STEP ${logNo}-2] 📌 Supabase月次件数の加算開始`);
    // 月次件数加算（ffprodとffdevとで別々）
    // 上位のindex.jsでctx.waitUntil()で包んでるからここでは不要
    await addMonthCount(env);

  } catch (err) {
    console.warn(`[STEP ${logNo}-3] ⚠️ 月次件数加算または通知で例外:`, err);
  }
}

