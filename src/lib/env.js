// lib/env.js
// =======================================
// ✅ Cloudflasre Workers 向け 環境変数定義ファイル
// ---------------------------------------
// 💡 本ファイルは Secrets や定数の安全かつ柔軟な管理を目的としています。
// 🔐 機密性の高い値（アクセストークンなど）は、Secretsとして Cloudflare Workers に登録しておき、
//    ここでは isProd を元に、環境（本番 / 開発）を自動判定して出し分けます。
// ---------------------------------------
// import os from "os"; // Node.js標準モジュール
// const platform = os.platform();

export function getEnv(env) {

  // 環境変数をenv.XXXXと読むのは、Wrangler が env を引数として fetch() に渡してくれるため、
  // その中にある環境変数が唯一の参照方法
	const projectId = env.GCLOUD_PROJECT || "";

	// ✅ 本番判定（CLIバッチ or 通常）
	const isProd = (projectId === "inuichiba-ffworkers-ffprod");

	return {
		isProd,
		projectId,
		channelAccessToken: getConfigValue(env, isProd ? "CHANNEL_ACCESS_TOKEN_FFPROD" : "CHANNEL_ACCESS_TOKEN_FFDEV"),
		channelSecret:      getConfigValue(env, isProd ? "CHANNEL_SECRET_FFPROD" : "CHANNEL_SECRET_FFDEV"),
		supabaseKey:        getConfigValue(env, isProd ? "SUPABASE_SERVICE_ROLE_KEY_FFPROD" : "SUPABASE_SERVICE_ROLE_KEY_FFDEV"),
		supabaseUrl:        getConfigValue(env, isProd ? "SUPABASE_URL_FFPROD" : "SUPABASE_URL_FFDEV"),
		usersTable:         isProd ? "users_ffprod" : "users_ffdev",
		baseDir:            "https://inuichiba-ffimages.pages.dev/",
    usersKV:            isProd ? env.users_kv_ffprod : env.users_kv_ffdev,
    kvApiToken:         isProd ? env.KV_API_TOKEN_FFPROD : env.KV_API_TOKEN_FFDEV,
	};

}		// getEnvの終わり

// =======================================
// タブ付きリッチメニュー用スクリプトに特化した関数
// (ディレクトリを確保する関数は別にあるので注意)
// =======================================
export function getEnvInfo(env) {

  // ローカル実行の場合は、OS の「環境変数」にアクセスするため process.env を使う
  const projectId = process.env.GCLOUD_PROJECT || "";
  const isProd = projectId === "inuichiba-ffworkers-ffprod";

  // タブ付きリッチメニュー画面のありかが相対パスからURLに変わったので
  // リッチメニュー関数内でディレクトリを扱うことになったことに注意
  // const imageDir = path.join(process.cwd(), "src", "richmenu-manager", "data");

/**
	console.log(`🔎 env keysの先頭10文字: ${Object.keys(env).slice(0, 5)}...}`);
  console.log("🔎 projectId:", projectId);
	console.log("🔎 isProd:", isProd);
	console.log(`🔐 CHANNEL_ACCESS_TOKEN_FFDEV の長さ: ${env.CHANNEL_ACCESS_TOKEN_FFDEV.length}`);
  console.log(`🔐 CHANNEL_ACCESS_TOKEN_FFDEV の先頭5文字: ${env.CHANNEL_ACCESS_TOKEN_FFDEV.slice(0, 5)}...`);
*/

	return {
		isProd,
		projectId,
    channelAccessToken: getConfigValue(env, isProd ? "CHANNEL_ACCESS_TOKEN_FFPROD" : "CHANNEL_ACCESS_TOKEN_FFDEV"),
	};
}

	// =======================================
	// 🔹 secrets の安全取得ユーティリティ
	// =======================================
  function getConfigValue(env, key, fallback = "") {
    const value = env?.[key];
    return typeof value === "string" ? sanitizeEnvVar(value) : fallback;
  }



	// =======================================
	// 🔹 全Secrets読み込み箇所に BOM & trim()など安全処理を施す
	// ---------------------------------------
	// スクリプト側で BOM を除去しても「完全には防げない」ため
	// .ps1 などでSecrets登録前に改行やBOMを除去していても、
	// gcloud CLIやローカルエディタのクセで BOM が入るケースは完全には防げません。
	// そのため、「アプリ側で安全処理」を入れておくのは
	// 実運用における二重セーフティとしてとても優れた設計です。
	// =======================================
	export function sanitizeEnvVar(value) {
  	if (typeof value !== "string") return value;
  	let v = value;

		// BOM（Byte Order Mark）を除去
	  if (v.charAt(0) === "\uFEFF") v = v.slice(1);

		// 制御文字（null, \r, \n, \t など）を削除
  	v = v.replace(/[\u0000-\u001F]/g, "");

		return v.trim();
	}


  // =======================================/
	// 🔹 デバッグ時専用、安全なログ出力（console.logで機密を出さない工夫）
	// ---------------------------------------
	// Secretsの値は出力しないよう、「長さ」「先頭文字列」などに制限して確認します
  // 呼び出したらisProd/!isProdにかかわらず表示しますので注意しましょうね
  // =======================================
	export const logSecretSafe = (label, value) => {
		try {
			if (value === undefined) {
      	console.warn(`⚠️ ${label} は undefined です`);
    	} else if (value === null) {
      	console.warn(`⚠️ ${label} は null です`);
    	} else if (typeof value === "string") {
      	if (value.length > 0) {
          console.log(`🔐 ${label} の長さ: ${value.length}`);
          console.log(`🔐 ${label} の先頭5文字: ${value.slice(0, 5)}...`);
      	}	else {
        	console.warn(`⚠️ ${label} は空文字列です`);
      	}
    	} else {
      	console.warn(`⚠️ ${label} の型が予期しない形式です（型: ${typeof value}）`);
    	}
		} catch (e) {
    	console.error(`❌ ${label} のログ出力に失敗しました`, e);
		}
  };


	// =======================================
	// 🔹 安全なログ出力を使った機密情報の表示(ffdevのみ)
	// =======================================
	// functionと同じ。こうすると実行時に初めて呼ばれる
	export const seeSecretInfo = (env) => {
  	const { isProd, projectId, channelSecret, channelAccessToken,
						supabaseKey, supabaseUrl, usersTable } = getEnv(env);

		console.log("🐾 環境判定された projectId(GCLOUD_PROJECT):", projectId || "(未定義)");
  	console.log("🐾 isProd:", isProd);
		if (isProd) {
			console.log("channelSecret", 			"🔒(省略)");
  		console.log("channelAccessToken", "🔒(省略)");
  		console.log("Supabase Key", 			"🔒(省略)");
		} else {
			logSecretSafe("channelSecret", 			channelSecret);
  		logSecretSafe("channelAccessToken", channelAccessToken);
  		logSecretSafe("Supabase Key", 			supabaseKey);
		}
		console.log("📦 Supabase URL:", 	 supabaseUrl);
  	console.log("📦 Supabase Table(usersTable)", usersTable);
	};


