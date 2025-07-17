// lib/saveUserInfo.js
import { getUserProfile } from './lineApiHelpers.js';
import { writeUserDataToSupabase } from './writeUserDataToSupabase.js';
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
 * Supabase にユーザーデータを書き込む（ffprod=初回のみ、ffdev=毎回上書き）
 * @param {object} userId - Supabase に保存するキーのひとつ
 * @param {object} groupId - Supabase に保存するキーのひとつ
 * @param {object} label - 今実行しているイベント名(follow/message/postback/join)
 * @param {object} env - 環境変数（supabaseUrl, supabaseKey を含む）
 */
export async function saveUserProfileAndWrite(userId, groupId, eventType, env) {
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

    // eventTypeの入れ損ねをココで救う
    const label = eventType ?? "unknown";

    // コンソールログは writeUserDataToSupabase() が出してるので出さない

    // KVでスキップしてSupabaseに書き込まなかったとき
    if (result?.skipped) {
      return new Response(label + " SKIPPED", { status: 200 });
    }

    // エラー通知や再試行判定
    if (result?.error) {
      return new Response(label + " NG", { status: 500 });
    }

    // それ以外は成功
    return new Response(label + " OK", { status: 200 });

  } catch (err) {
    const label = eventType ?? "unknown";
    console.error("💥 Supabase KV または書き込み処理中に例外:", err);
    return new Response(label + " NG", { status: 500 });
  }
}


