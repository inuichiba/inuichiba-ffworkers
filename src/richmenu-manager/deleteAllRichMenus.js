// richmenu-manager/deleteAllRichMenus.js

export async function deleteRichMenusAndAliases(channelAccessToken) {

  try {
    await unsetDefaultRichMenu(channelAccessToken);
    
    for (const aliasId of ["switch-to-a", "switch-to-b"]) {
      await deleteRichMenuAliases(channelAccessToken, aliasId);
    }
    
    await deleteAllRichMenus(channelAccessToken);
    
    console.log('✅ すべてのリッチメニューとエイリアスを削除しました');
  
  } catch (e) {
    console.error('❌ 全体処理中にエラー:', e.message);
  }

}


//  デフォルトリッチメニューの解除関数
async function unsetDefaultRichMenu(channelAccessToken) {
  const res = await fetch("https://api.line.me/v2/bot/user/all/richmenu", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${channelAccessToken}`, },
  });
  
  if (res.ok) {
    console.log('🚫 デフォルトリッチメニューを解除しました');
  } else {
    const text = await res.text();
    console.warn('⚠ デフォルトリッチメニュー解除エラー:', `${res.status} ${text}`);
  }
}


// リッチメニューエイリアスをすべて削除する関数
async function deleteRichMenuAliases(channelAccessToken, aliasId) {
    const res = await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${channelAccessToken}`, },
    });
    
    if (res.status === 200) {
      console.log(`🧹 エイリアス '${aliasId}' を削除しました`);
    } else if (res.status === 404) {
      console.warn(`⚠ エイリアス '${aliasId}' は存在しなかったのでスキップしました`);
		} else {
			// 404 以外は本当のエラーだから投げる
      const text = await res.text();
      throw new Error(`❌ エイリアス '${aliasId}' の削除失敗: ${res.status} ${text}`);
		}
}


// すべてのリッチメニューを取得して削除
async function deleteAllRichMenus(channelAccessToken) {
  const res = await fetch("https://api.line.me/v2/bot/richmenu/list", {
    method: "GET",
    headers: { Authorization: `Bearer ${channelAccessToken}`, },
  });
  
  const json = await res.json();
  const menus = json.richmenus || [];

  if (menus.length === 0) {
    console.log('📭 リッチメニューは登録されていません');
    return;
  }

  for (const menu of menus) {
    const delRes = await fetch(`https://api.line.me/v2/bot/richmenu/${menu.richMenuId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${channelAccessToken}`, },
    });

    if (delRes.ok) {
      console.log(`🧹 リッチメニュー削除成功: ${menu.richMenuId}`);
    } else {
      const text = await delRes.text();
      console.error(`❌ リッチメニュー削除失敗: ${menu.richMenuId} - ${text}`);
    }
  }
}

