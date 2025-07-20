// lib/saveUserInfo.js
import { getUserProfile } from './lineApiHelpers.js';
import { writeToSb } from './sbWriter.js';
import { getEnv } from"./env.js";


// ✅ 日本時間のタイムスタンプ（先頭0なしのH形式）
// 例）2025/05/09 6:16:53
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
 * イベント情報を元にSupabaseとKVに非同期で書き込む
 * - 書き込み失敗時も止めない（ログ出力のみ）
 * - この関数自体はawaitせずに使われる
 * @param {object} event - LINE Webhook から渡されるイベントオブジェクト（type, source 等を含む）
 * @param {object} env   - 環境変数（supabaseUrl, supabaseKey 等を含む）
 */
export async function saveUserInfo(event, env) {
  const { isProd } = getEnv(env);
  const userId = event.source?.userId || null;
  const groupId = event.source?.groupId || event.source?.roomId || "default";

  // 🚫 userId が null のときは Supabase 書き込みを中断
  // 応答メッセージ経由、joinイベント（イベントがない）など
  if (!userId) {
    if (!isProd) console.warn(`⚠️ userId が null のため Supabase 書き込みをスキップ：event.type=${event.type}`);
    return;
  }

  // 🧩 ユーザー情報をSupabase用に整形
  let profile = null;
  try {
    profile = await getUserProfile(userId, env);
  } catch(err) {
    // プロフィールが取れない場合は書き込まない
    // userId が取得できない（＝未follow・ブロック・無効トークン）時に、
    // null プロフィールを渡しても Supabase に意味のあるデータは残せない
    // また、null による displayName や pictureUrl などが undefined や
    //  "null" になって、誤ったデータが入る危険がある
    // LINEチャネル設定ミス可能性も有(アクセストークンのスコープにPROFILE権限がない)
    // profileがnull のためスキップ
		if (!isProd) console.warn(`⚠️ ユーザープロフィール情報の取得に失敗（null）: userId=${userId}, groupId=${groupId}, err=`,err);
    return;
  }

  const displayName   = profile?.displayName   || null;
  const pictureUrl    = profile?.pictureUrl    || null;
  const statusMessage = profile?.statusMessage || null;
  const timestamp = getFormattedJST();
  const shopName  = null;  // inputData とともに将来機能のため現在は null を送信
  const inputData = null;

  try {
    // 📤 Supabase + KV 書き込み処理
    // awaitは内部でOK（ctx.waitUntil() で投げられてるのでイベント処理には影響なし）
    const res = await writeToSb({
      timestamp,
      groupId,
      userId,
      displayName,
      pictureUrl,
      statusMessage,
      shopName,
      inputData
    }, env);

    if (!isProd) console.log(`📄 ${event.type} イベントの Supabase 書き込み結果:`, res);

  } catch (err) {
    // 書き込み失敗しても止まらずログ出力して続行
    console.error(`❌ ${event.type} イベントの Supabase 書き込み処理中にエラー:`, err.stack || err);
  }

}


