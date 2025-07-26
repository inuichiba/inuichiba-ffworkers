// lib/kvUtils.js
import { getEnv } from "./env.js";
import { getFormattedJST } from "./saveUserInfo.js";


/**
 * ✅ UTC基準の日付文字列を "YYYY-MM-DD" で返す
 */
export function getUTCDateString() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`; // 例: 2025-07-24
}

/**
 * ✅ UTC基準のタイムスタンプを "YYYY-MM-DD HH:mm:ss" 形式で返す
 */
export function getUTCTimestamp() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}



/**
 * 📈 Supabase月次件数を加算し、しきい値を超えたらSupabase月次フラグと通知を設定(UTC基準）
 * @param {object} env - 環境変数
*/
export async function addMonthCount(env) {
  const { isProd, usersKV } = getEnv(env);
  // Supabase月次件数   → writeCount:ffprod:2025-07 形式(日時はUTC)
  const monthKey  = `writeCount:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString().slice(0, 7)}`;
  // Supabase月次フラグ → supabase_flag:ffprod:2025-07 形式(日時はUTC)
  const sbFlagKey = `supabase_flag:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString().slice(0, 7)}`;

  try {
    const currentValue = await usersKV.get(monthKey);
    const current = parseInt(currentValue || "0", 10);
    if (!isProd) console.log(`📈 KVのSupabase月次件数 取得: 件数=${current}, monthKey=${monthKey}`);
    const updated = current + 1;
    await usersKV.put(monthKey, updated.toString());
    if (!isProd) console.log(`🔄 KVのSupabase月次件数 加算: 件数=${updated}, monthKey=${monthKey}`);

    // ✅ しきい値チェック（90,000件以上）
    if (updated >= 90000 && current < 90000) { // ← しきい値（100000件中90%）
      await usersKV.put(sbFlagKey, "threshold", { expirationTtl: 60 * 60 * 24 * 92 });  // 92日間(3ヶ月保存)
      // ffprodで出ることを案じているのでログは出す
      console.warn("🚨 Supabase月次件数がしきい値を超えました → フラグをthresholdに設定します");
      const message = `🚨 Supabase月次件数が80%を超過！\n件数=${updated}, monthKey=${monthKey}\n📛 Supabase書き込みを停止します。`;
      notifyDiscord(env, message);  // Discordに通知する
    }

  } catch(err) {
    if (!isProd) console.warn(`⚠️ KVのSupabase月次件数 or しきい値 更新失敗: monthKey=${monthKey}`, err);
  }
}



/**
 * 📈 KV日次件数を加算し、しきい値を超えたらKV日次フラグと通知を設定(UTC基準）
 * @param {object} env - 環境変数
*/
export async function incrementKVReadCount(env) {
  const { isProd, usersKV } = getEnv(env);
  // KV日次件数   → readCount:ffprod:2025-07-24 形式(日時はUTC)
  const todayKey = `readCount:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString()}`;
  // KV日次フラグ → kv_flag:ffprod:2025-07-24 形式(日時はUTC)
  const kvFlagKey = `kv_flag:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString()}`;

  try {
    const currentValue = await usersKV.get(todayKey);
    const current = parseInt(currentValue || "0", 10);
    if (!isProd) console.log(`📖 KV日次件数 取得: 件数=${current}, todaykey=${todayKey}`);
    const updated = current + 1;
    await usersKV.put(todayKey, updated.toString());
    if (!isProd) console.log(`📚 KV日次件数 加算: 件数=${updated}, todaykey=${todayKey}`);

    // ✅ しきい値チェック（80,000件以上）
    if (updated >= 80000 && current < 80000) { // ← しきい値（100000件中80%）
      await usersKV.put(kvFlagKey, "threshold", { expirationTtl: 60 * 60 * 24 * 3 }); // 3日間保存
      // ffProdで出ることを案じているので、ログは出す
      console.warn("🚨 KV日次カウンターが80,000件を超えました → フラグをthresholdに設定します");
      const message = `🚨 KV日次カウンターが80,000件を超過！\n件数=${updated} todayKey=${todayKey}\n📛 HTML表示モードに切り替えます。`;
      notifyDiscord(env, message);  // Discordに通知する
    }

  } catch (err) {
    if (!isProd) console.warn(`⚠️ KV日次Read加算 or しきい値 更新失敗: todayKey=${todayKey}`, err);
  }
}



/**
 * ✅ Discord通知を行う（UTC＋JSTタイムスタンプ付き）
 * @param {object} env
 * @param {string} message
 */
export async function notifyDiscord(env, message) {
  const { isProd, discordWebhookUrl } = getEnv(env);

  if (!discordWebhookUrl) {
    if (!isProd) console.warn("⚠️ DISCORD_WEBHOOK_URL が未設定です");
    return;
  }

  const title = isProd ? "⚠️【inuichiba-ffworkers-ffprod】" : "⚠️【inuichiba-ffworkers-ffdev】";
  const utc = getUTCTimestamp();
  const jst = getFormattedJST();
  const fullMessage = `${title}\n🕒 UTC: ${utc}\n🕘 JST: ${jst}\n${message}`;

  try {
    const payload = { content: fullMessage };
    await fetch(discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!isProd) console.log("✅ Discord通知送信成功");

  } catch (err) {
    if (!isProd) console.warn("⚠️ Discord通知失敗:", err);
  }
}




/**
 * 🚦 混雑状態かどうかをチェックして、混雑なら true、混雑してないなら false を返す
 * @param {Object} env - 環境変数（KVなどを含む）
 * @returns {boolean} - 混雑中なら true、通常時は false
 */
export async function isCongested(env) {
  const { isProd, usersKV } = getEnv(env);

  try {
    // KV日次フラグを組み立て → kv_flag:ffprod:2025-07-24 形式(日時はUTC)
    const kvFlagKey = `kv_flag:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString()}`;
    const kvFlag = await usersKV.get(kvFlagKey);
    // getしたけどindex.jsで加算するからここではKV日次件数を加算しない

    // KV日次フラグがない or あっても値が threshold 以外 であれば混雑していない
    // kvFlag が threshold のとき true、違ったら false を返す
    return kvFlag === "threshold";

  } catch(err) {
    if (!isProd) console.warn("⚠️ KV日次フラグの読み込みに失敗しました", err);
    return true; // エラー時は「混雑中」とみなす
  }
}

