// lib/kvUtils.js
import { getEnv } from"./env.js";

/**
 * 📌 現在の JST（日本時間）を yyyy-MM 形式で返す（KV月次キー用）
 * @returns {string} "YYYY-MM" の形式
 */
function getCurrentMonthKey() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const year = jstNow.getFullYear();
  const month = (jstNow.getMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}


/**
 * 📊 月次カウントキーの形式に変換
 * @param {string} yyyymm - "YYYY-MM" 形式の文字列
 * @returns {string} KVで使うキー（例: writeCount:2025-07）
 */
function formatMonthKey(yyyymm) {
  return `writeCount:${yyyymm}`;
}



/**
 * 📈 月次カウントのインクリメント処理
 * @param {KVNamespace} env - 環境変数
*/
export async function addMonthCount(env) {
  const { isProd, usersKV } = getEnv(env);

  const yyyymm = getCurrentMonthKey();
  const countKey = formatMonthKey(yyyymm);

  if (!isProd) console.log("📌 月次カウント用キー:", countKey);
  if (!isProd) console.log("📌 月次カウント加算処理を開始");

  try {
    // 現在の件数を KV から取得
    if (!isProd) console.log("🔄 KVから月次件数を取得中: ", countKey);
    const currentValue = await usersKV.get(countKey);
    if (!isProd) console.log("📥 既存件数取得完了:", currentValue);

    const count = parseInt(currentValue || "0", 10);
    // if (!isProd) console.log("📥 既存件数:", count);

    const newCount = count + 1;
    // if (!isProd) console.log("📤 新しい件数:", newCount);

    await usersKV.put(countKey, newCount.toString());
    if (!isProd) console.log("📤 KVに新しい件数を書き込みます:", newCount);
  } catch (err) {
    if (!isProd) console.warn("⚠️ 月次カウント処理で例外:", err);
    throw err; // 上位でも補足可能なように再スロー
  }
}


