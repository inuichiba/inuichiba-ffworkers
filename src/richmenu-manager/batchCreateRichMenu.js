// batchCreateRichMenu.js（CLIで実行用）
// 実行方法
//   cd d:\nasubi\inuichiba-ffscripts
//   .\ffworkers-set-secrets.ps1 -env ffdev(既定値)  --- 開発環境用
//   .\ffworkers-set-secrets.ps1 -env ffprod       	--- 本番環境用

import { deleteRichMenusAndAliases } from './deleteAllRichMenus.js';
import { handleRichMenu } from './richMenuHandler.js';
import { getEnvInfo } from"../lib/env.js";

// メイン処理
export async function main() {
  // PowerShellで env(process.env) 注入済み
  const { isProd, channelAccessToken, imageDir } =  getEnvInfo(process.env); 

  console.log("🧭 GCLOUD_PROJECT:", process.env.GCLOUD_PROJECT);

  console.log("🔁 リッチメニュー初期化を開始します");

  console.log("🗑️ 既存リッチメニューの削除を開始します");
  await deleteRichMenusAndAliases(channelAccessToken);
  console.log("🗑️ 既存リッチメニューの削除を完了しました");

  console.log("✅ リッチメニューの再作成を開始します");
  await handleRichMenu(isProd, channelAccessToken, imageDir);
  console.log("✅ リッチメニューの再作成を完了しました");

}

main();
