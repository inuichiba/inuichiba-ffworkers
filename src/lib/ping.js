import { createClient } from "@supabase/supabase-js";
import { getEnv } from"./env.js";

// KVを使った「月ごとの書き込み回数カウント」
export async function trackWriteCount(env) {
  const now = new Date();
  const ym = now.toISOString().slice(0, 7); // "2025-07"
  const key = `writeCount:${ym}`;
  const countStr = await env.MY_KV.get(key);
  const count = Number(countStr ?? "0");

  const limit = 10000;
  if (count >= limit) {
    console.warn("✋ Supabase書き込み上限を超えたのでスキップされました。Workers & Pages Variables の ALLOW_SUPABASE_WRITE を false に設定してください。");

    // 追加: Discord通知も可
    await fetch(env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `⚠️ Supabase書き込み上限超過（${count}/${limit}）` }),
    });
    return false;
  }

  await env.MY_KV.put(key, (count + 1).toString());
  return true;
}


// writeCount:2025-07の保存先 → 保存先：Cloudflare Workersの KV
// 直接見る手段はないため、Workersコードで読み出し確認するための関数
export async function getWriteCount(env) {
  const ym = new Date().toISOString().slice(0, 7); // 例: 2025-07
  const key = `writeCount:${ym}`;
  const count = await env.MY_KV.get(key);
  return count || "0";
}



// Supabaseの「使用状況可視化Ping」
export async function pingSupabase(env) {
  const { isProd, supabaseUrl, supabaseKey, usersTable } = getEnv(env);
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error, count } = await supabase
    .from(usersTable) // テーブル名を開発・本番で切替可
    .select("*", { count: "exact", head: true });

  const now = new Date().toISOString();
  if (error) {
    console.error(`❌ ${now} Supabase ping error:`, error);
    return { status: "NG", error };
  }

  if (!isProd) console.log(`📊 ${now} Supabase OK, user count: ${count}`);
  return { status: "OK", userCount: count };
}


