/**
 * notify.js
 * --------------------------
 * ✅ 目的:
 * GitHub Actions などから通知メッセージを受け取るためのエンドポイント。
 * JSON形式の { "content": "通知内容" } を POST すると、内容をログ出力し、
 * レスポンスとして確認メッセージを返します。
 * ただし課金枠に入ります。
 *
 * 🔁 現在の状況（2025年7月時点）:
 * - GitHub Actions の通知先は Discord Webhook に直接切り替えたため、
 *   このエンドポイントは現在は使用されていません。
 * - ただし、通知の中継・加工・保存などの目的で、
 *   将来的に再活用する可能性があるため、コードは保管しています。
 *
 * 💡 備考:
 * - Cloudflare Workers の無料リクエスト数を節約する
 *   (要するに課金されないよう頑張る)ため、
 *   現在はこのルートへのアクセスを行っていません。
 * - Supabaseのテーブルへのcurl(ping)でエラーがあったときだけ、
 *   Discord通知 + GitHubメール通知の二重通知体制で運用中です。
 * - Supabaseへのcurlのエラー通知(console.log)を、
 *   課金覚悟で Cloudflare Workers に通知してほしいとき、
 *   ・Windowsの場合 D:\nasubi\inuichiba-ffscripts\.github\workflows\ping-supabase.ymlの
 *   ・Mac/Unixの場合 /Users/yourname/projectname/inuichiba-ffscripts/.github/workflows/ping-supabase.yml"の
 *   DISCORD_WEBHOOK_URL (3か所。GitHub Secretsに定義済) を
 *   WORKERS_NOTIFY_URL (これも定義済) に書き換えれば使えます。
 */


export async function onRequestPost(context) {
  try {
    const { request } = context;
    const payload = await request.json();

    const content = payload.content;

    if (!content || typeof content !== "string") {
      return new Response("Invalid content", { status: 400 });
    }

    // ログに出す（後でKV保存やメール連携も可能）
    console.log("📨 通知内容:", content);

    // レスポンスとしてそのまま表示
    return new Response(
      `✅ 通知を受信しました（${new Date().toISOString()}）\n\n${content}`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      }
    );
  } catch (err) {
    console.error("❌ JSON parse error:", err);
    return new Response("Invalid JSON", { status: 400 });
  }
}
