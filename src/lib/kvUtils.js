// lib/kvUtils.js
// -----------------------------------------------------------------------------
// ■KV操作の運用ルール（※後継者向けに必ず読むこと）
//
// 1) 失敗してもユーザー応答は止めない
//    - ここにある putKV / delKV / runKvBatch は「throwしない」ベストエフォート設計。
//    - 失敗は戻り値オブジェクトで返す（ok/code/error）。Discord側で1イベント=1通に集約通知。
//    - ffprodでは console.log / console.warn は出さない（env.js の isProd で抑制）。重大は console.error or Discord。
//
// 2) KV のレート制限（超重要）
//    - 「同一キー」への書き込み系（PUT/DELETE）は **1秒に1回まで**。
//    - これを超えると **429 Too Many Requests** が返る。
//    - 429時は 1.1s → 2.2s → 3.3s の指数バックオフで最大3回だけ再試行。
//    - “同一キー”に対する並行 PUT/DELETE を Promise.all で一斉に叩くと衝突しやすい。
//      → ホットキー（例: readCount:..., todayKey など頻繁に触るキー）は**単発 await**で処理し、他のフラグ類は並列でOK。
//      → DELETE も「書き込み」扱いで同じ制限がかかる点に注意。
//
// 3) 通知とログ
//    - runKvBatch は失敗を集約し、Discord通知は本文のみ送る（環境名や時刻はDiscord側で自動付与）。
//    - タイトル（title）は「sb90 フラグ更新」「kvdel フラグ削除」など“どの処理か”が分かる文言を渡す。
//    - 「429（レート制限）」と「非429（設定/認可/存在しない namespace 等）」は code で区別（0/429/500など）。
//
// 4) コーディング規約
//    - アロー関数や map 等は使わず、できるだけ素直な書き方。
//    - 返り値は常に { ok, op, key, attempts, code, error } の統一形（throwしない）。
// -----------------------------------------------------------------------------


import { getEnv } from "./env.js";
import { getFormattedJST } from "./getFormattedJST.js";


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
 * 📈 Supabase月次件数を加算し、しきい値90%を超えたらSupabase月次フラグと通知を設定(UTC基準）
 * @param {object} env - 環境変数
*/
export async function addMonthCount(env) {
  const { isProd, usersKV } = getEnv(env);
  // Supabase月次件数   → writeCount:ffprod:2025-07 形式(日時はUTC)
  const monthKey  = `writeCount:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString().slice(0, 7)}`;
  // Supabase月次フラグ → supabase_flag:ffprod:2025-07 形式(日時はUTC)
  const sbFlagKey = `supabase_flag:${isProd ? "ffprod" : "ffdev"}:${getUTCDateString().slice(0, 7)}`;

  try {
    const current = await getOrInitInt(usersKV, monthKey, (60 * 60 * 24 * 92));
    if (!isProd) console.log(`📈 KVのSupabase月次件数 取得: 件数=${current}, monthKey=${monthKey}`);

    const newCount = current + 1;

    if (isProd) {
      await putKV(usersKV, monthKey, newCount.toString(), 0, env);  // ffprodは永続保存
    } else {
      const TTL92 = 60 * 60 * 24 * 92;
      await putKV(usersKV, monthKey, newCount.toString(), TTL92, env);  // ffdevは3ヶ月（92日間）保存
      if (!isProd) console.log(`🔄 KVのSupabase月次件数 加算: 件数=${newCount}, monthKey=${monthKey}`);
    }

    // ✅ しきい値チェック（90,000件以上）
    if (newCount >= 90000) {
      const notified = await usersKV.get(sbFlagKey);

      if (typeof notified !== "string") {
        // ✅ 通知していない → 通知＋フラグまとめて立てる
        console.warn(`🚨 Supabase月次件数が90%を超えました → ${isProd ? "ffprod" : "ffdev"}でのSupabase書き込みを停止します。`);
        console.error (`🚨 ${isProd ? "ffdev" : "ffprod"}へ"sb90"を入力して、Supabase書き込みを停止させてください。`);
        const message = `🚨 Supabase月次件数が90%を超過しました！\n` +
          `📛 ${isProd ? "ffprod" : "ffdev"}件数=${newCount}, monthKey=${monthKey}\n` +
          `📛 ${isProd ? "ffdev" : "ffprod"}へ"sb90"を入力して、Supabase書き込みを停止してください。\n` +
          `📛 Supabase月次件数は、ffprod/ffdevの合算で一か月単位で課金を計算されます。\n` +
          `📛 両者の件数を合算の上対応をご検討ください。\n`;

        try {
          await notifyDiscord(env, message);
        } catch(e) {
          console.error("supabase90% 通常到達：フラグ更新時に Discord 送信エラー", e.message);
        }

        const TTL92 = 60 * 60 * 24 * 92;
        const tasks = [
          putKV(usersKV, sbFlagKey, "threshold", TTL92, env),  // 3ヶ月(92日間)保存
        ];
        const labels = [
          "supabase_Flag"
        ];

        await runKvBatch("supabase90% 通常到達：フラグ更新", tasks, labels, env, notifyDiscord);

        if (!isProd) console.log("🏁 Discord通知(supabase90%)とフラグ処理を完了しました");
      }
    }

  } catch(err) {
    if (!isProd) console.warn(`⚠️ KVのSupabase月次件数 or しきい値 更新失敗: monthKey=${monthKey}`, err);
  }
}



/**
 * 📌 KV日次読み取り件数をカウントし、しきい値(80%, 90%, 100%)でDiscord通知する
 * @param {object} env - 環境変数
*/
export async function incrementKVReadCount(env) {
  const { isProd, usersKV } = getEnv(env);
  // SENTINEL：自分は存在するよの意味
  const KV_SENTINEL = "1";

  const today = getUTCDateString(); // 例: "2025-07-29"
  // KV日次件数   → readCount:ffprod:2025-07-24 形式(日時はUTC)
  const todayKey = `readCount:${isProd ? "ffprod" : "ffdev"}:${today}`;
  // KV日次フラグ → kv_flag:ffprod:2025-07-24 形式(日時はUTC)
  const kvFlag   = `kv_flag:${isProd ? "ffprod" : "ffdev"}:${today}`;

  // 内部フラグ
  const notifyFlag80  = `kv_notify_sent:total80:${today}`;
  const notifyFlag90  = `kv_notify_sent:total90:${today}`;
  const notifyFlag100 = `kv_notify_sent:total100:${today}`;

  const KV_DAILY_THRESHOLD = 80000;  // しきい値は 8万件（課金寸前）
  const KV_DAILY_EMERGENCY = 90000;  // 緊急事態は 9万件（無料枠は10万件）
  const KV_DAILY_LIMIT     = 100000; // 手遅れ（かっきーん）10万件以上

  try {
    // ✅ KV日次件数取得と計算(KV日次件数キーがなかったら"0"で初期化して作る)
    const current = await getOrInitInt(usersKV, todayKey, (60 * 60 * 24 * 3));
    if (!isProd) console.log(`📖 KV日次件数 取得: 件数=${current}, todaykey=${todayKey}`);

    // ✅ 加算した値を保存（TTLは3日間）
    const newCount = current + 1;
    const TTL3 = 60 * 60 * 24 * 3;
    await putKV(usersKV, todayKey, newCount.toString(), TTL3, env); // 3日間保存
    if (!isProd) console.log(`📚 KV日次件数 加算: 件数=${newCount}, todaykey=${todayKey}`);


    // 🚧 100%（手遅れ）→ 💸
    if (newCount >= KV_DAILY_LIMIT) {
      const [notified, flagSet] = await Promise.all([
        usersKV.get(notifyFlag100),
        usersKV.get(kvFlag)
      ]);
      try {
        if (typeof notified !== "string") {
          // ✅ 通知していない → 通知＋フラグまとめて立てる
          console.warn(`🚨 ${isProd ? "ffprod" : "ffdev"}のKV日次件数が100%を超過しました → 課金フェーズです。`);
          console.error(`🚨 ${isProd ? "ffdev" : "ffprod"}へ"kv100"を入力して、課金フェーズにしてください。`);
          const message = `🚨 ${isProd ? "ffprod" : "ffdev"}のKV日次件数が100%を超過しました！\n` +
            `💸 ${isProd ? "ffprod" : "ffdev"}件数=${newCount}  🗝️ todayKey=${todayKey}\n` +
            `💸 ${isProd ? "ffdev" : "ffprod"}へ"kv100"を入力して、課金フェーズに合わせて下さい。\n` +
            `💸 2025年7月時点での課金額の例（Cloudflare Workers KV）：\n` +
            `   💸 Read 超過 … $0.50 / 百万件\n` +
            `   💸 Write 超過 … $5.00 / 百万件\n` +
            `   💸 Storage 超過 … $0.50 / GB・月\n` +
            `   💡 例）\n` +
            `      ・Read が10万件超過 → 約 $0.05 / 日\n` +
            `      ・Write が1,000件超過 → 約 $0.005 / 日\n` +
            `💸 従量課金制のため、超過数が増えるほど請求額も比例して増えていきます。\n` +
            `💸 KV日次件数(read)は、ffprodとffdevの合算でUTC時間で一日単位で課金を計算されます(日本時間で朝9時頃クリアされます)。\n` +
            `💸 両者の件数を合算の上対応をご検討ください。`;

          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("kv100% 通常到達：フラグ更新時に Discord 送信エラー", e.message);
          }

          const TTL3 = 60 * 60 * 24 * 3;
          const tasks = [
            putKV(usersKV, notifyFlag100, KV_SENTINEL, TTL3, env),
            putKV(usersKV, notifyFlag90,  KV_SENTINEL, TTL3, env),
            putKV(usersKV, notifyFlag80,  KV_SENTINEL, TTL3, env),
            putKV(usersKV, kvFlag,        "threshold", TTL3, env),
          ];
          const labels = [
            "notifyFlag100",
            "notifyFlag90",
            "notifyFlag80",
            "kvFlag"
          ];

          await runKvBatch("kv100 通常到達：フラグ更新", tasks, labels, env, notifyDiscord);

          if (!isProd) console.log("🏁 Discord通知(kv100%)とフラグ処理を完了しました");


        } else if (typeof flagSet !== "string") {
          // ✅ 通知済みだけどフラグだけ未設定 → フラグ補完
          const TTL3 = 60 * 60 * 24 * 3;
          await putKV(usersKV, kvFlag, "threshold", TTL3, env)
          if (!isProd) console.warn("⚠️ Discord通知済みだがkvFlag未設定 → 補完しました");
        }

      } catch (e) {
        console.error("❌ kv100通知エラー:", e);
      }
    return;
    }


    // ✅ 緊急フェーズ(90,000件/100,000件 /日)
    if (newCount >= KV_DAILY_EMERGENCY) {
      const [notified, flagSet] = await Promise.all([
        usersKV.get(notifyFlag90),
        usersKV.get(kvFlag)
      ]);
      try {
        if (typeof notified !== "string") {
          // ✅ 通知していない → 通知＋フラグまとめて立てる
          console.warn(`🚨 ${isProd ? "ffprod" : "ffdev"}のKV日次件数が90%を超えました → 緊急フェーズです。`);
          console.error(`🚨 ${isProd ? "ffdev" : "ffprod"}へ"kv90"を入力して、緊急フェーズに合わせてください。`);
          const message = `🚨 ${isProd ? "ffprod" : "ffdev"}KV日次件数が90%を超過しました！\n` +
                `🔥 ${isProd ? "ffprod" : "ffdev"}件数=${newCount}  🗝️ todayKey=${todayKey}\n` +
                `🔥 ${isProd ? "ffdev" : "ffprod"}へ"kv90"を入力して、緊急フェーズに合わせてください。\n` +
                `🔥 このままではKV Read上限（100,000件）に達して、Cloudflare Workersに課金が発生します。\n` +
                `🔥 最終手段として LINE Developers の Webhook を手動で「OFF」にして通知そのものを止めることも検討できます。\n` +
                `🔥 ただしこの対応を行うと、メニュータップなどに一切応答しなくなります。\n` +
                `🔥 通常はおすすめしませんが、無課金維持を最優先する場合の緊急手段としてご検討ください。`;

          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("kv90% 通常到達：フラグ更新時に Discord 送信エラー", e.message);
          }

          const TTL3 = 60 * 60 * 24 * 3;
          const tasks = [
            putKV(usersKV, notifyFlag90, KV_SENTINEL, TTL3, env),
            putKV(usersKV, notifyFlag80, KV_SENTINEL, TTL3, env),
            putKV(usersKV, kvFlag,       "threshold", TTL3, env),
          ];
          const labels = [
            "notifyFlag90",
            "notifyFlag80",
            "kvFlag"
          ];

          await runKvBatch("kv90 通常到達：フラグ更新", tasks, labels, env, notifyDiscord);

          if (!isProd) console.log("🏁 Discord通知(kv90%)とフラグ処理を完了しました");


        } else if (typeof flagSet !== "string") {
          // ✅ 通知済みだけどフラグだけ未設定 → フラグ補完
          const TTL3 = 60 * 60 * 24 * 3;
          await putKV(usersKV, kvFlag, "threshold", TTL3, env);
          if (!isProd) console.warn("⚠️ Discord通知済みだがkvFlag未設定 → 補完しました");
        }

      } catch (e) {
        console.error("❌ kv90通知エラー:", e);
      }
    return;
    }


    // ✅ 警戒フェーズ(80,000件/100,000件 /日)
    if (newCount >= KV_DAILY_THRESHOLD) {
      const [notified, flagSet] = await Promise.all([
        usersKV.get(notifyFlag80),
        usersKV.get(kvFlag)
      ]);
      try {
        if (typeof notified !== "string") {
          // ✅ ココは大切なのでffprodでもコンソールログを出す
          console.warn(`🚨 ${isProd ? "ffprod" : "ffdev"}のKV日次件数が80%を超過しました → 警戒フェーズです。congestedメッセージ表示モードに切り替えます`);
          console.error(`🚨 ${isProd ? "ffdev" : "ffprod"}へ"kv80"を入力して、警戒フェーズに合わせてください。`);
          console.error(`🚨 LINE Official Managerの「応答メッセージ」設定にあるQRコードメッセージの「利用」スイッチを、手動で「OFF」にしてください。`);

          const message = `🚨 ${isProd ? "ffprod" : "ffdev"}のKV日次件数が80%を超過しました！\n` +
                `📈 ${isProd ? "ffprod" : "ffdev"}件数=${newCount}  🗝️ todayKey=${todayKey}\n` +
                `📈 Cloudflare Workers混雑モードを開始します。\n` +
                `📈 ${isProd ? "ffdev" : "ffprod"}へ"kv80"を入力して、警戒フェーズに合わせてください。\n` +
                `📈 LINE Official Managerの「応答メッセージ」設定にあるQRコードメッセージの「利用」スイッチを、手動で「OFF」にしてください。\n` +
                `📈 KV日次件数(read)は、ffprodとffdevの合算でUTC時間で一日単位で課金を計算されます(日本時間で朝9時頃クリアされます)。\n` +
                `📈 両者の件数を合算の上対応をご検討ください。`;

          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("kv80% 通常到達：フラグ更新時に Discord 送信エラー", e.message);
          }

          const TTL3 = 60 * 60 * 24 * 3;
          const tasks = [
            putKV(usersKV, notifyFlag80, KV_SENTINEL, TTL3, env),
            putKV(usersKV, kvFlag,       "threshold", TTL3, env),
          ];
          const labels = [
            "notifyFlag80",
            "kvFlag"
          ];

          await runKvBatch("kv80 通常到達：フラグ更新", tasks, labels, env, notifyDiscord);

          if (!isProd) console.log("🏁 Discord通知(kv80%)とフラグ処理を完了しました");


        } else if (typeof flagSet !== "string") {
          // ✅ 通知済みだけどフラグだけ未設定 → フラグ補完
          await putKV(usersKV, kvFlag, "threshold", TTL3, env);
          if (!isProd) console.warn("⚠️ Discord通知済みだがkvFlag未設定 → 補完しました");
        }

      } catch (e) {
        console.error("❌ kv80通知エラー:", e);
      }
    return;
    }

  } catch (err) {
    if (!isProd) console.warn(`⚠️ KV日次件数(Read)加算 or しきい値 更新失敗: todayKey=${todayKey}`, err);
  }
}




/**
 * KVやSupabaseにメッセージイベントとして入力されたコマンドの処理を行います。
 * ffprodとffdevの間で同じ状態になるように、手動で入力して対応してください。
 * @param {object} env  - 環境変数
 * @param {string} data - "sb90"/"kv80"/"kv90"/"kv100"/"kvdel"
 *                        "kvdel"はKV日次件数の値もクリアします(評価用です)。
 */
export async function setFlagKVSB(env, data) {
  const { isProd, usersKV } = getEnv(env);

  const today  = getUTCDateString();
  // Supabase月次件数   → writeCount:ffprod:2025-07 形式(日時はUTC)
  const monthKey  = `writeCount:${isProd ? "ffprod" : "ffdev"}:${today.slice(0, 7)}`;
  // Supabase月次フラグ → supabase_flag:ffprod:2025-07 形式(日時はUTC)
  const sbFlag = `supabase_flag:${isProd ? "ffprod" : "ffdev"}:${today.slice(0, 7)}`;

  // KV日次件数   → readCount:ffprod:2025-07-24 形式(日時はUTC)
  const todayKey = `readCount:${isProd ? "ffprod" : "ffdev"}:${today}`;
  // KV日次フラグ → readCount:ffprod:2025-07-24 形式(日時はUTC)
  const kvFlag = `kv_flag:${isProd ? "ffprod" : "ffdev"}:${today}`;

  // 内部フラグ
  const notifyFlag80  = `kv_notify_sent:total80:${today}`;
  const notifyFlag90  = `kv_notify_sent:total90:${today}`;
  const notifyFlag100 = `kv_notify_sent:total100:${today}`;
  // SENTINEL：自分は存在するよの意味
  const KV_SENTINEL = "1";

  data = data.toLowerCase();

  try {
    // Supabase 90%超過
    if (data === "sb90" ) {
      const notified = await usersKV.get(sbFlag);
      try {
        if (typeof notified !== "string") {
          // ✅ 通知していない → 通知＋フラグまとめて立てる
          const cnt = await getOrInitInt(usersKV, monthKey, (60 * 60 * 24 * 92));
          if (!isProd) console.log(`📈 KVのSupabase月次件数 取得: 件数=${cnt}, monthKey=${monthKey}`);

          const newCnt = cnt + 1;
          const TTL92 = 60 * 60 * 24 * 92;

          if (isProd) {
            await putKV(usersKV, monthKey, newCnt.toString(), 0, env);  // ffprodは永続保存
          } else {
            await putKV(usersKV, monthKey, newCnt.toString(), TTL92, env);  // ffdevは3ヶ月（92日間）保存
            if (!isProd) console.log(`🔄 KVのSupabase月次件数 加算: 件数=${newCnt}, monthKey=${monthKey}`);
          }

          // ffprodで出ることを案じているのでログは出す
          console.warn(`🚨 ${isProd ? "ffprod" : "ffdev"}にSupabase月次件数が90%を超えるコマンドが入力されました → Supabase書き込みを停止します`);
          console.error(`🚨 ${isProd ? "ffdev" : "ffprod"}にも"sb90"を入力して同じ状態にしてください。`);

          const message = `🚨 ${isProd ? "ffprod" : "ffdev"}にSupabase月次件数が90%を超過するコマンドが入力されました！Supabase書き込みを停止します。\n` +
            `📛 ${isProd ? "ffprod" : "ffdev"}件数=${newCnt}, monthKey=${monthKey}\n` +
            `📛 ${isProd ? "ffdev" : "ffprod"}にも"sb90"を入力してSupabase書き込みを停止させてください。\n` +
            `📛 Supabase月次件数(アクセス件数)はffprod/ffdevの合算で一か月単位で課金処理されます。\n`;

          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("sb90 コマンド受付：フラグ更新時に Discord 送信エラー", e.message);
          }

          const tasks = [
            putKV(usersKV, sbFlag, "threshold", TTL92, env),  // 3ヶ月(92日間)保存
          ];
          const labels = [
            "SupabaseFlag(sbFlag)"
          ];

          await runKvBatch("sb90 フラグ更新", tasks, labels, env, notifyDiscord);

        }

        if (!isProd) console.log("🏁 コマンド処理 → Discord通知(sb90)とフラグ削除処理を完了しました");

      } catch(err) {
        if (!isProd) console.warn(`⚠️ KVのSupabase月次件数 or しきい値 更新失敗: monthKey=${monthKey}`, err);
      }
      return;
    }


    // ✅ KV日次件数取得と計算(KV日次件数キーがなかったら"0"で初期化して作る)
    const current = await getOrInitInt(usersKV, todayKey, (60 * 60 * 24 * 3));
    if (!isProd) console.log(`📖 KV日次件数 取得: 件数=${current}, todaykey=${todayKey}`);

    // ✅ 加算した値を保存（TTLは3日間）
    const newCount = current + 1;
    const TTL3 = 60 * 60 * 24 * 3;
    await putKV(usersKV, todayKey, newCount.toString(), TTL3, env); // 3日間保存
    if (!isProd) console.log(`📚 KV日次件数 加算: 件数=${newCount}, todaykey=${todayKey}`);

    // kvdel用関係するキーを全て削除する



    // ✅ "kvdel"(緊急フェーズなどなどで立てた緊急KVキーを削除し、通常フェーズに戻る)
    if (data === "kvdel") {
      try {
        if (typeof notified !== "string") {
          // ✅ 通知していない → 通知＋フラグ3つまとめて立てる
          console.warn(`🚨 ${isProd ? "ffprod": "ffdev"}にKV日次件数、KVフラグの値をクリアするコマンドが入力されました。`);
          console.error(`🚨 ${isProd ? "ffprod": "ffdev"}のLINE Official Managerの「応答メッセージ」設定にあるQRコードメッセージの「利用」スイッチを、手動で「ON」に 戻してください。`);
          console.error(`🚨 ${isProd ? "ffdev" : "ffprod"}にも"kvdel"を入力して同じ状態にしてください。`);

          const message = `🚨 ${isProd ? "ffprod" : "ffdev"}にKV日次件数、KVフラグの値をクリアするコマンドが入力されました。\n` +
                `🧯 ${isProd ? "ffprod" : "ffdev"}件数=${newCount} から0へ変更されました 🗝️ todayKey=${todayKey}\n` +
                `🧯 ${isProd ? "ffprod" : "ffdev"}のLINE Official Managerの「応答メッセージ」設定にあるQRコードメッセージの「利用」スイッチを、手動で「ON」に 戻してください。\n` +
                `🧯 ${isProd ? "ffdev" : "ffprod"}にも"kvdel"を入力して同じ状態にするようご検討ください。\n`;

          // 同じキーに登録できるのは1秒に一度まで。
          // todayKeyは設定されないとヤバイので、直列で実施
          const TTL3 = 60 * 60 * 24 * 3;
          await putKV(usersKV, todayKey, "0", TTL3, env); // 3日間保存

          // tasksに入れられるのはdelKV/putKVのみ
          // Discord通知は通常通り直列処理で実施
          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("kvdel コマンド受付：フラグ削除時に Discord 送信エラー", e.message);
          }

          // その後に並列でOKなものを流す
          const tasks = [
            delKV(usersKV, kvFlag,        env),
            delKV(usersKV, notifyFlag80,  env),
            delKV(usersKV, notifyFlag90,  env),
            delKV(usersKV, notifyFlag100, env),
          ];
          const labels = [
            "kvFlag",
            "notifyFlag80",
            "notifyFlag90",
            "notifyFlag100",
          ];
          await runKvBatch("kvdel フラグ削除", tasks, labels, env, notifyDiscord);

          if (!isProd) console.log("🗑️ KVフラグ類を削除しました");


        } else if (typeof flagSet !== "string") {
          try {
            // ✅ 通知済みだけどフラグだけ未設定 → フラグ補完
            await putKV(usersKV, kvFlag, "threshold", TTL3, env)
            if (!isProd) console.warn("⚠️ Discord通知済みだがkvFlag未設定 → 補完しました");
          } catch (e) {
            if (!isProd) console.warn("⚠️ Discord通知後のkvFlag補完に失敗しました", e);
          }
        }

        if (!isProd) console.log("🏁 コマンド処理 → Discord通知(kvdel)とフラグ削除処理を完了しました");

      } catch (e) {
        console.error("❌ kvdel通知エラー:", e);
      }
    return;
    }



    // KV日次件数100%(手遅れ)💸
    if (data === "kv100") {
      // await Promise.allとは。。。
      // 2つのPromise（非同期処理）を「同時に」実行する(単なるawaitと違って超高速になる)
      // 2つとも「一斉に」始まり、全部成功したら次に進む
      // ヒット1つでも失敗したら即catchに入る
      const [notified, flagSet] = await Promise.all([
        usersKV.get(notifyFlag100),
        usersKV.get(kvFlag)
      ]);
      try {
        if (typeof notified !== "string") {
          // ✅ 通知していない → 通知＋フラグ3つまとめて立てる
          console.warn(`🚨 ${isProd ? "ffprod" : "ffdev"}でKV日次件数が100%を超過するコマンドが入力されました → 課金フェーズに入ります`);
          console.error(`🚨 ${isProd ? "ffdev" : "ffprod"}も同じ状態になるよう"kv100"を入力してください。`);

          const message = `🚨 ${isProd ? "ffProd" : "ffdev"}にKV日次件数が100%を超過するコマンドが入力されました！課金フェーズに入ります。\n` +
            `💸 ${isProd ? "ffprod" : "ffdev"}件数=${newCount}  🗝️ todayKey=${todayKey}\n` +
            `💸 ${isProd ? "ffdev" : "ffprod"}にも"kv100"を入力して同じく課金フェーズにしてください。\n` +
            `💸 従量課金制のため、超過数が増えるほど請求額も比例して増えていきます。\n` +
            `💸 次の午前9時以降にリセットされますので、ffprod+ffdev合算の上対応をご検討ください。`;

          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("kv100 コマンド受付：フラグ更新時に Discord 送信エラー", e.message);
          }

          // await Promise.allSettledとは？
          // 全部「同時に」実行(単なるawaitと違って超高速になる)
          // 全部のPromiseの「結果」（成功・失敗）をすべて待つ
          // 失敗したものも含めて「全件終わるまで」進まない
          const TTL3 = 60 * 60 * 24 * 3;
          const tasks = [
            putKV(usersKV, kvFlag,        "threshold", TTL3, env),
            putKV(usersKV, notifyFlag80,  KV_SENTINEL, TTL3, env),
            putKV(usersKV, notifyFlag90,  KV_SENTINEL, TTL3, env),
            putKV(usersKV, notifyFlag100, KV_SENTINEL, TTL3, env)
          ];
          const labels = [
            "kvFlag",
            "notifyFlag80",
            "notifyFlag90",
            "notifyFlag100"
          ];
          await runKvBatch("kv100 フラグ更新", tasks, labels, env, notifyDiscord);


        } else if (typeof flagSet !== "string") {
          try {
            // ✅ 通知済みだけどフラグだけ未設定 → フラグ補完
            await putKV(usersKV, kvFlag, "threshold", TTL3, env)
            if (!isProd) console.warn("⚠️ Discord通知済みだがkvFlag未設定 → 補完しました");
          } catch (e) {
            if (!isProd) console.warn("⚠️ Discord通知後のkvFlag補完に失敗しました", e);
          }
        }

        if (!isProd) console.log("🏁 コマンド処理 → Discord通知(kv100)とフラグ処理を完了しました");

      } catch (e) {
        console.error("❌ kv100通知エラー:", e);
      }
    return;
    }


    // ✅ 緊急フェーズ(90,000件/100,000件 /日)
    if (data === "kv90") {
      const [notified, flagSet] = await Promise.all([
        usersKV.get(notifyFlag90),
        usersKV.get(kvFlag)
      ]);
      try {
        if (typeof notified !== "string") {
          // ✅ 通知していない → 通知＋フラグ3つまとめて立てる
          console.warn(`🚨 ${isProd ? "ffprod" : "ffdev"}でKV日次件数が90%を超えるコマンドが入力されました → 緊急フェーズに入ります`);
          console.error(`🚨 ${isProd ? "ffdev" : "ffprod"}も同じ状態になるよう"kv90"を入力してください。`);

          const message = `🚨 ${isProd ? "ffprod" : "ffdev"}でKV日次件数が90%を超過するコマンドが入力されました！緊急フェーズに入ります。\n` +
                `🔥 ${isProd ? "ffprod" : "ffdev"}件数=${newCount}  🗝️ todayKey=${todayKey}\n` +
                `🔥 ${isProd ? "ffdev" : "ffprod"}も"kv90"を入力して同じく緊急フェーズにしてください。\n` +
                `🔥 この段階ですと、最終手段として LINE Developers の Webhook を手動で「OFF」にして通知そのものを止めることも検討できます。\n` +
                `🔥 ただしこの対応を行うと、メニュータップなどに一切応答しなくなります。`

          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("kv90 コマンド受付：フラグ更新時に Discord 送信エラー", e.message);
          }

          const TTL3 = 60 * 60 * 24 * 3;
          const tasks = [
            putKV(usersKV, kvFlag,       "threshold", TTL3, env),
            putKV(usersKV, notifyFlag80, KV_SENTINEL, TTL3, env),
            putKV(usersKV, notifyFlag90, KV_SENTINEL, TTL3, env)
          ];
          const labels = [
            "kvFlag",
            "notifyFlag80",
            "notifyFlag90"
          ];
          await runKvBatch("kv90 フラグ更新", tasks, labels, env, notifyDiscord);


        } else if (typeof flagSet !== "string") {
          try {
            // ✅ 通知済みだけどフラグだけ未設定 → フラグ補完
            await putKV(usersKV, kvFlag, "threshold", TTL3, env)
            if (!isProd) console.warn("⚠️ Discord通知済みだがkvFlag未設定 → 補完しました");
          } catch (e) {
            if (!isProd) console.warn("⚠️ Discord通知後のkvFlag補完に失敗しました", e);
          }
        }

        if (!isProd) console.log("🏁 コマンド処理 → Discord通知(kv90)とフラグ処理を完了しました");

      } catch (e) {
        console.error("❌ kv90通知エラー:", e);
      }
    return;
    }


    // ✅ 警戒フェーズ(80,000件/100,000件 /日)
    if (data === "kv80") {
      const [notified, flagSet] = await Promise.all([
        usersKV.get(notifyFlag80),
        usersKV.get(kvFlag)
      ]);
      try {
        if (typeof notified !== "string") {
          // ✅ 通知＆両フラグ設定
          console.warn(`🚨 ${isProd ? "ffprod" : "ffdev"}でKV日次件数が80%を超過するコマンドが入力されました → 警戒フェーズに入ります。congestedメッセージ表示モードに切り替えます`);
          console.error(`📈 LINE Official Managerの「応答メッセージ」設定にあるQRコードメッセージの「利用」スイッチを、手動で「OFF」にしてください。`);
          console.error(`📈 ${isProd ? "ffdev" : "ffprod"}も同じ状態になるよう"kv80"を入力してください。`);

          const message = `🚨 ${isProd ? "ffprod" : "ffdev"}でKV日次件数が80%を超過するコマンドが投入されました！警戒フェーズを開始します。\n` +
                `📈 ${isProd ? "ffprod" : "ffdev"}件数=${newCount}  🗝️ todayKey=${todayKey}\n` +
                `📈 ${isProd ? "ffdev" : "ffprod"}にも"kv80"を入力して同じ警戒フェーズにください。\n` +
                `📈 KV日次件数(read件数)は、ffprodとffdevの件数（少なめに計算してあります）の一日単位の合算で課金処理がs行われます。\n` +
                `📈 なお、必ずLINE Official Managerの「応答メッセージ」設定にあるQRコードメッセージの「利用」スイッチを、手動で「OFF」にしてください。`;

          try {
            await notifyDiscord(env, message);
          } catch(e) {
            console.error("kv80 コマンド受付：フラグ更新時に Discord 送信エラー", e.message);
          }

          const TTL3 = 60 * 60 * 24 * 3;
          const tasks = [
            putKV(usersKV, kvFlag,       "threshold", TTL3, env),
            putKV(usersKV, notifyFlag80, KV_SENTINEL, TTL3, env)
          ];
          const labels = [
            "kvFlag",
            "notifyFlag80"
          ];
          await runKvBatch("kv80 フラグ更新", tasks, labels, env, notifyDiscord);

        } else if (typeof flagSet !== "string") {
          try {
           // ✅ Discord通知済みだけどフラグだけ未設定 → フラグ補完
            await putKV(usersKV, kvFlag, "threshold", TTL3, env)
            if (!isProd) console.warn("⚠️ Discord通知済みだがkvFlag未設定 → 補完しました");
          } catch (e) {
            if (!isProd) console.warn("⚠️ Discord通知後のkvFlag補完に失敗しました", e);
          }
        }

        if (!isProd) console.log("🏁 コマンド処理 → Discord通知(kv80)とフラグ処理を完了しました");

      } catch (e) {
        console.error("❌ kv80通知エラー:", e);
      }
    return;
    }

  } catch (err) {
    if (!isProd) console.warn(`⚠️ Supabase月次件数加算 / KV日次件数（Read）加算 or しきい値 更新失敗`, err);
  }
}




// -----------------------------------------------------------------------------
// 目的:
//   1) KV操作は「ユーザー応答を止めない」= すべて throw しない（ベストエフォート）
//   2) 失敗は共通フォーマットで収集し、Discord 通知を 1イベント=1通 に集約
//   3) ffprod では console.log / console.warn を抑制（isProd=true）
//      → ffprod: console.error だけ許可 / 重要度に応じ Discord へ
//
// 依存:
//   - getEnv(env) から isProd を取得（env.js）
//   - notifyDiscord(env, message) は既存実装を利用
//
// 返却フォーマット（常に throw せずオブジェクトで返す）:
//   { ok:boolean, op:"PUT"|"DEL", key:string, attempts(429時のリトライ回数):number, code:number, error:string }
//     code: 0=成功, 429=レート制限で3回失敗, 500=非429の失敗（認可・設定など）
//     error: 人間向けメッセージ（空文字のこともある）
//
// 推奨の使い方:
//   - ホットキー（例: todayKey初期化）は個別に await putKV(...)
//   - それ以外のフラグ類は tasks 配列に積み、await runKvBatch("タイトル", tasks, labels, env)
//   - 既存の Promise.allSettled(...)+console.warn の塊は runKvBatch(...) 1行に置換
//
// 注意:
//   - このモジュール内では環境名や時刻を本文に入れません（Discord側で付与）
// -----------------------------------------------------------------------------

// 内部ヘルパ: ログ制御（ffprodでは warn/log を抑制）
function logInfo(env, msg) {
  const { isProd } = getEnv(env);
  if (!isProd) console.log(msg);
}
function logWarn(env, msg) {
  const { isProd } = getEnv(env);
  if (!isProd) console.warn(msg);
}
function logError(env, msg) {
  // isProd でも出す
  console.error(msg);
}

// 統一の戻り値生成
function _kvResult(ok, op, key, attempts, code, error) {
  return { ok: ok, op: op, key: key, attempts: attempts, code: code, error: error || "" };
}

// 低レベル実体（PUT/DEL 共通）: throwしない
async function kvOp(op, kv, key, val, ttlSec, env) {
  let attempt = 0;
  while (attempt < 3) {
    try {
      var opts = null;
      if (typeof ttlSec === "number" && ttlSec > 0) {
        opts = { expirationTtl: ttlSec };
      } else if (ttlSec && typeof ttlSec === "object"
        && typeof ttlSec.expirationTtl === "number"
        && ttlSec.expirationTtl > 0) {
        // 旧呼び出し互換: { expirationTtl: N } も受ける
        opts = { expirationTtl: ttlSec.expirationTtl };
      }

      if (op === "PUT") {
        if (opts) await kv.put(key, val, opts);
        else      await kv.put(key, val);
      } else if (op === "DEL") {
        await kv.delete(key);

      } else {
        logWarn(env, "⚠️ unsupported op: " + op);
        return _kvResult(false, op, key, attempt, 400, "unsupported op");
      }

      // 成功
      if (attempt > 0) logWarn(env, "ℹ️ KV " + op + " retry success key=" + key + " attempts=" + (attempt + 1));
      return _kvResult(true, op, key, attempt + 1, 0, "");

    } catch (e) {
      let msg = e && e.message ? e.message : String(e);
      let is429 = msg.indexOf("429") !== -1;
      attempt = attempt + 1;

      if (!is429) {
        // 非429は即終了（自動復旧しづらい）
        logWarn(env, "⚠️ KV " + op + " failed non-429 key=" + key + " msg=" + msg);
        return _kvResult(false, op, key, attempt, 500, msg);
      }

      // 429 はバックオフで再試行（1.1s, 2.2s, 3.3s）
      let waitMs = 1100 * attempt;
      logWarn(env, "⏳ KV 429 backoff " + waitMs + "ms key=" + key + " attempt=" + attempt);
      await new Promise(function (r) { setTimeout(r, waitMs); });
    }
  }
  // 429連敗
  logWarn(env, "⚠️ KV " + op + " 429 exhausted key=" + key);
  return _kvResult(false, op, key, 3, 429, "Too Many Requests");
}

// 公開API: PUT / DEL（throwしない）
/**
 * KVへのPUT（throwしないベストエフォート）
 * - 同一キーは「1秒に1回まで」の制限あり。超過で 429 -> バックオフ再試行。
 * - ttlSec=0 または number でない場合は永続保存。
 * - 戻り値: { ok, op:"PUT", key, attempts, code, error }
 *   code: 0=成功 / 429=3回バックオフ後も失敗 / 500=非429のエラー（認可/設定など）
 */
export function putKV(kv, key, val, ttlSec, env) {
  return kvOp("PUT", kv, key, val, ttlSec, env);
}


/**
 * KVのDELETE（throwしないベストエフォート）
 * - DELETE も「書き込み」扱いで同一キー1秒1回の制限がある（429出る）。
 * - 戻り値: { ok, op:"DEL", key, attempts, code, error }
 */
export function delKV(kv, key, env) {
  return kvOp("DEL", kv, key, "", 0, env);
}





/**
 * KVバッチ実行＋Discord通知（1イベント=1通）
 * - title: この処理の識別名（例: "kv100 フラグ更新"）
 * - tasks: putKV()/delKV() の Promise 群（throwしない想定）
 * - labels: 表示名（"kvFlag" など）。tasks と同順。なくても可。
 * - title: 「sb90 フラグ更新」「kvdel フラグ削除」など処理名。Discord本文に入れる。
 * - notifyDiscord: 既存の通知関数を呼ぶ（外部から渡す）
 * - shouldNotify: 省略時 true
 *
 * - 失敗は r.value.ok=false または r.status!=="fulfilled" を収集して本文整形。
 * - 環境ヘッダと時刻は Discord 側で付与する前提。ここでは本文のみ送る。
 *
 * - 使い方
 *   ✅ ホットキー（同一キーで衝突しやすい）は単発で
 *    await putKV(usersKV, todayKey, "0", 60*60*24*3, env);
 *
 *   ✅ フラグ類は並列＆集約通知
 *    const tasks = [ putKV(usersKV, kvFlag, "threshold", TTL3, env), … ];
 *    const labels = ["kvFlag", "notifyFlag80", …];
 *    await runKvBatch("kv100 フラグ更新", tasks, labels, env, notifyDiscord);
 */
export async function runKvBatch(title, tasks, labels, env, notifyDiscord) {
  let settled = await Promise.allSettled(tasks);

  let fails = [];
  let i = 0;
  while (i < settled.length) {
    let r = settled[i];
    let name = labels && labels[i] ? labels[i] : ("task#" + (i + 1));

    if (r.status !== "fulfilled") {
      // ラッパ自体がreject（想定外）。止めずに記録。
      fails.push(name + ": rejected");
    } else {
      let v = r.value; // kvOpの戻り値
      if (!v || !v.ok) {
        let line = name + ": " + (v ? (v.op + " " + v.key + " code=" + v.code + " attempts=" + v.attempts) : "unknown");
        // v.error は KVタスク（putKV/delKV）が内部で catch(e) したときの例外理由
        if (v && v.error) line = line + " msg=" + v.error;  // 例外理由を載せる
        fails.push(line);
      }
    }
    i = i + 1;
  }

  if (fails.length > 0) {
    let body = "「" + title + "」で一部失敗（処理は継続済）\n"
             + "―― 失敗詳細（" + fails.length + "件）――\n"
             + fails.join("\n")
             + "\n―― 対策: しばらく待って再試行、または手動同期をご検討ください。";

    // ffprod: console.error で要注意を残す / ffdev: warnでも十分
    logError(env, "Discord通知: " + title + " 失敗=" + fails.length);

    try {
      await notifyDiscord(env, body);
    } catch (_) {
      // _ を使って理由を出す（stack→message→String順）
      let reason = (_ && _.stack) ? _.stack : ((_ && _.message) ? _.message : String(_));
      logError(env, "❌ Discord通知送信に失敗: " + title + " / reason=" + reason);
    }

  } else {
    logInfo(env, "✅ KVバッチ成功: " + title);
  }
}




/**
 * GETして、キーが存在しなければdefaultValue（例: "0"）で初期化してPUTする
 * エラーコード429(1秒以内に再度put)を起こさないようにする
 * @param {object} usersKV - Cloudflare KV namespace
 * @param {string} key - KVキー名
 * @param {number} TTL - TTL（秒単位）。0のときは永続。
 * @param {string} defaultValue - 初期値（文字列）。省略時は "0"
 * @returns {number} - 取得または初期化された数値（10進数）
 */
async function getOrInitInt(usersKV, key, TTL, defaultValue = "0") {
  let value = await usersKV.get(key);
  if (typeof value !== "string") {
    // 存在しなければ初期化（同時実行でぶつかることがあるので try/catch）
    try {
      value = defaultValue;
      if (TTL === 0) {
        await usersKV.put(key, defaultValue);  // 永続保存
      } else {
        await usersKV.put(key, defaultValue, { expirationTtl: TTL });  // TTL付き
      }
    } catch(e) {
      // 429（同一キー1秒/回の制限）だけは少し待ってから再取得
      let msg = (e && e.message) ? e.message : String(e);
      if (msg.indexOf("429") !== -1) {
        await new Promise(function (r) { setTimeout(r, 1200); }); // 1.2秒待つ
      } else {
        console.warn("⚠️ usersKV PUT 429以外の失敗（続行します）:", e); // 別原因はコンソールエラーを出して続行
      }
    }
    // もう一度読む（誰かが先に初期化した場合でもここで拾える）
    value = await usersKV.get(key);
    if (typeof value !== "string") value = defaultValue;
  }

  let n = parseInt(value, 10);  // 10進数の数値で戻す
  if (isNaN(n)) n = 0;
  return n;

}




/**
 * ✅ Discord通知を行う（ffprod/ffdevのラベル ＋ UTC＋JSTタイムスタンプ付き）
 * @param {object} env
 * @param {string} message
 */
export async function notifyDiscord(env, message, label = null) {
  const { isProd, discordWebhookUrl } = getEnv(env);

  if (!discordWebhookUrl) {
    if (!isProd) console.warn("⚠️ DISCORD_WEBHOOK_URL が未設定です");
    return;
  }

  const title =
    label === "total" ? "🚨 【ffprod/ffdev合算】" :
      isProd ? "🚨 【inuichiba-ffworkers-ffprod】" : "🚨 【inuichiba-ffworkers-ffdev】";

  const utc = getUTCTimestamp();
  const jst = getFormattedJST();
  const fullMessage = `${title}\n🕒 UTC: ${utc}   🕘 JST: ${jst}\n\n${message}\n\n`;

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
  const today = getUTCDateString();
  const kvFlagKey = `kv_flag:${isProd ? "ffprod" : "ffdev"}:${today}`;  // KV日次フラグ

  try {
    const kvFlag = await usersKV.get(kvFlagKey);
    // getしたけどindex.jsで加算するからここではKV日次件数を加算しない

    // フラグがない or あっても値が threshold 以外 であれば混雑していない
    return kvFlag === "threshold";

  } catch(err) {
    if (!isProd) console.warn("⚠️ KV日次フラグの読み込みに失敗しました", err);
    return true; // エラー時は「混雑中」とみなす
  }
}


