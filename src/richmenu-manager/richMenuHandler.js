// functions/richmenu-manager/richMenuHandler.js
// バッチで有償とは関係ないからコンソールログは出す

import fs from "fs/promises"; // 非同期用 
import path from "path";

// //////////////////////////////////////////////////
// リッチメニューのサイズ
// 次の条件をクリアすること
// ・横幅は800px～2500px 縦幅は250px以上
// ・幅/高さのアスペクト比は1.45以上
// ・LINE推奨は width: 2500, height: 843 
const wAll  = 2000;
const hAll  = 1200;
const wItem =  500;
const hItem =  500;
const wTab  = 1000;
const hTab  =  200;


// //////////////////////////////////////////////////
// リッチメニューの開始
// 新しいリッチメニューを作成する
// //////////////////////////////////////////////////
export async function handleRichMenu(isProd, channelAccessToken, imageDir) {
	let bRichMenuId;
  let imagePathA, imagePathB;
  
	try {
  	// リッチメニューを作成してリッチメニューIdを紐づける(LINE部品まで呼ぶ)
    const aRichMenuId = await aCreateRichMenu(channelAccessToken);
    if (aRichMenuId) {
			console.log(`✅ 画面Aの aRichMenuId の作成に成功しました：richMenuId = ${aRichMenuId}`);
		} else {
		  console.error("❌ 画面Aの aRichMenuId が作成できませんでした。処理を中止します");
		  return;	
	  }
  	
    if(isProd) {
      bRichMenuId = await bCreateRichMenu(channelAccessToken);
    } else {
      bRichMenuId = await bCreateRichMenuYoichi(channelAccessToken); 
    }
	  
    if (bRichMenuId) {
			console.log(`✅ 画面Bの bRichMenuId の作成に成功しました：richMenuId = ${bRichMenuId}`);
		} else {
		  console.error("❌ 画面Bの bRichMenuId が作成できませんでした。処理を中止します");
		  return;	
	  }

    // リッチメニューに画面を紐づけてアップロードする(JPEGのみ可)
    if (isProd) {
	    imagePathA   = path.join(imageDir, "tabA2025autumn.jpg");
      imagePathB   = path.join(imageDir, "tabB2025autumn.jpg");
    } else {
			imagePathA   = path.join(imageDir, "tabA2025spring.jpg");
			imagePathB   = path.join(imageDir, "tabB2025spring.jpg");
    }	
    
    const imageBufferA = await fs.readFile(imagePathA);
    const imageBufferB = await fs.readFile(imagePathB);
    if (!imageBufferA || !imageBufferB) {
      console.error("❌ 画像読み込みに失敗しました（imageBufferA/B が空）");
      return;
    }

    console.log("");
    await checkJpegMagicNumbers(imagePathA);
  //  console.log("📄 読み込みパス:", imagePathA);
  //  console.log("✅ imageBufferA 読み込み成功:", imageBufferA.length, "bytes");
  //  console.log("🎯 richMenuId:", aRichMenuId);
  //  console.log("🔑 channelAccessToken:", channelAccessToken.slice(0, 5), "..."); // 最初だけ
    console.log("");

    await new Promise(resolve => setTimeout(resolve, 1000));  // 1秒待つ(即時にrichMenuIdを使わない)

    
    const uploadFlgA = await lineUploadRichMenuImage(channelAccessToken, aRichMenuId, imageBufferA);
    if (!uploadFlgA) {
      console.error("❌ 画面A のアップロードができませんでした。処理を中止します");
      return;
    }
    console.log("✅ 画面A のアップロードに成功しました");
		
    const uploadFlgB = await lineUploadRichMenuImage(channelAccessToken, bRichMenuId, imageBufferB);
		if (!uploadFlgB) {
      console.error("❌ 画面B のアップロードができませんでした。処理を中止します");
      return;
    }
    console.log("✅ 画面B のアップロードに成功しました");



  	// 既定値の画面を決める(最初にどちらのタブを出すか)
		const defaultFlg = await lineSetDefaultRichMenu(channelAccessToken, aRichMenuId);
		if (defaultFlg) {
			console.log("✅ 画面A を既定値に設定しました");
		} else {
		  console.error("❌ 画面A を規定値に設定できませんでした。処理を中止します");
		  return;	
	  }


		// エイリアスを定義する(タブの行き来ができるようにする)
		const aliasFlgA = await lineRegisterRichMenuAlias(channelAccessToken, aRichMenuId, "switch-to-a");
		if (aliasFlgA) {
			console.log("✅ 画面A のエイリアス switch-to-a の登録に成功しました");
		} else {
		  console.error("❌ 画面A のエイリアス switch-to-a の登録ができませんでした。処理を中止します");
		  return;	
	  }

		const aliasFlgB = await lineRegisterRichMenuAlias(channelAccessToken, bRichMenuId, "switch-to-b");
		if (aliasFlgB) {
			console.log("✅ 画面B のエイリアス switch-to-b の登録に成功しました");
		} else {
		  console.error("❌ 画面B のエイリアス switch-to-b の登録ができませんでした。処理を中止します");
		  return;	
	  }
  	
	} catch (error) {
    console.error('リッチメニューメインエラー:', error);
  }  
  	
}


// ///////////////////////////////////////
// リッチメニュー(タブA)の各タップ領域の定義
async function aCreateRichMenu(channelAccessToken) {
	try {
    const menuConfig = {
    	size: { width: wAll, height: hAll },
    	selected: true,
    	name: "タブＡ(左側メニュー)2025秋",  // バージョン管理用
    	chatBarText: "メニュー(表示/非表示)",
    	areas: [
      // タブA(左側のタブ)がタップされたらタブA画面に遷移する
        {
          bounds: { x: 0, y: 0, width: wTab, height: hTab },
          action: { type: "richmenuswitch", richMenuAliasId: "switch-to-a", data: "change to A" }
        },
      // タブB(右側のタブ)がタップされたらタブB画面に遷移する
        {
          bounds: { x: wTab, y: 0, width: wTab, height: hTab },
          action: { type: "richmenuswitch", richMenuAliasId: "switch-to-b", data: "change to B" }
        },

      // A1
        {
          bounds: { x: 0, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuA1", "displayText": "開催情報", "label": "　" }
        },
	    // A2
        {
          bounds: { x: wItem, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuA2", "displayText": "会場におけるマナーのお願い", "label": "　" }
        },
      // A3
        {
          bounds: { x:wItem*2, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuA3", "displayText": "パークアンドライド(P&R)", "label": "　" }
        },
      // 指定されたurlを開く
        {
          bounds: { x: wItem*3, y: hTab, width: wItem, height: hItem },
          action: { type: "uri", uri: "https://inuichiba.com/index.html" }
        },
	      
  	  // A4
        {
          bounds: { x: 0, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuA4", "displayText": "アクティビティに関するご案内", "label": "　" }
        },
	    // A5
        {
          bounds: { x: wItem, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuA5", "displayText": "ドッグランに関するご案内", "label": "　" }
        },
	    // A6
        {
          bounds: { x: wItem*2, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuA6", "displayText": "会場マップ\nショップリスト", "label": "　" }
        },
	    // A7
        {
          bounds: { x:wItem*3, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuA7", "displayText": "駐車場及びアクセス方法", "label": "　" }
        }
      ] 
	  };
  	
  	// リッチメニューを作りIdをもらう
  	const aRichMenuId = await lineCreateRichMenu(channelAccessToken, menuConfig);
  	return aRichMenuId;
  	
	} catch (error) {
    console.error('aRichMenuId 作成エラー:', error);
		return null;
  }  
  
}


// //////////////////////////////////////////////////
// リッチメニュー(タブB)の各タップ領域の定義
async function bCreateRichMenu(channelAccessToken) {
	try {
    const menuConfig = {
    	size: { width: wAll, height: hAll },
    	selected: true,
    	name: "タブＢ(右側メニュー)2025秋",
    	chatBarText: "メニュー(表示/非表示)",
    	areas: [
      	// タブA(左側のタブ)がタップされたらタブA画面に遷移する
        {
          bounds: { x: 0, y: 0, width: wTab, height: hTab },
          action: { type: "richmenuswitch", richMenuAliasId: "switch-to-a", data: "change to A" }
        },
      	// タブB(右側のタブ)がタップされたらタブB画面に遷移する
        {
          bounds: { x: wTab, y: 0, width: wTab, height: hTab },
          action: { type: "richmenuswitch", richMenuAliasId: "switch-to-b", data: "change to B" }
        },

        // B1
        {
          bounds: { x: 0, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB1", "displayText": "開催情報", "label": "　" }
        },
        // B2
        {
          bounds: { x: wItem, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB2",  "displayText": "会場におけるマナーのお願い", "label": "　" }
        },
      	// 指定されたurlを開く
        {
          bounds: { x: wItem*2, y: hTab, width: wItem*2, height: hItem },
          action: { type: "uri", uri: "https://inuichiba.com/index.html" }
        },
	      
  	    // B4
        {
          bounds: { x: 0, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB4",  "displayText": "アクティビティに関するご案内", "label": "　" }
        },
	      // B4
        {
          bounds: { x: wItem, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB4",  "displayText": "アクティビティに関するご案内", "label": "　" }
        },
	      // B6
        {
          bounds: { x: wItem*2, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB6",  "displayText": "会場マップ\nショップリスト", "label": "　" }
        },
	      // B7
        {
          bounds: { x:wItem*3, y:(hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB7",  "displayText": "駐車場及びアクセス方法", "label": "　" }
        }
    	]
		};
		
  	// リッチメニューを作りIdをもらう
  	const bRichMenuId = await lineCreateRichMenu(channelAccessToken, menuConfig);
  	return bRichMenuId;
  	
	} catch (error) {
    	console.error('bRichMenuId 作成エラー:', error);
  }  
  
}


// //////////////////////////////////////////////////
// リッチメニュー(異なるメニューのタブB)の各タップ領域の定義
async function bCreateRichMenuYoichi(channelAccessToken) {
	try {
    const menuConfig = {
    	size: { width: wAll, height: hAll },
    	selected: true,
    	name: "タブＢ(右側メニュー)2025春",
    	chatBarText: "メニュー(表示/非表示)",
    	areas: [
      	// タブA(左側のタブ)がタップされたらタブA画面に遷移する
        {
          bounds: { x: 0, y: 0, width: wTab, height: hTab },
          action: { type: "richmenuswitch", richMenuAliasId: "switch-to-a", data: "change to A" }
        },
      	// タブB(右側のタブ)がタップされたらタブB画面に遷移する
        {
          bounds: { x: wTab, y: 0, width: wTab, height: hTab },
          action: { type: "richmenuswitch", richMenuAliasId: "switch-to-b", data: "change to B" }
        },

        // B10
        {
          bounds: { x: 0, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB10", "displayText": "画像ファイル表示速度", "label": "　" }
        },
        // B11
        {
          bounds: { x: wItem, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB11", "displayText": "絵文字の表示", "label": "　" }
        },
	      // B3
        {
          bounds: { x: wItem*2, y: hTab, width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB3", "displayText": "パークアンドライド(P&R)", "label": "　" }
        },
      	// 指定されたurlを開く
        {
          bounds: { x: wItem*3, y: hTab, width: wItem, height: hItem },
          action: { type: "uri", uri: "https://inuichiba.com/yoichi/yoichi.html" }
        },
	      // B4
        {
          bounds: { x: wItem, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB4", "displayText": "アクティビティに関するご案内", "label": "　" }
        },
  	    // B4
        {
          bounds: { x: 0, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB4", "displayText": "アクティビティに関するご案内", "label": "　" }
        },
	      // B6
        {
          bounds: { x: wItem*2, y: (hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB6", "displayText": "会場マップ\nショップリスト", "label": "　" }
        },
	      // B7
        {
          bounds: { x:wItem*3, y:(hTab+hItem), width: wItem, height: hItem },
          action: { type: "postback", data: "tap_richMenuB7", "displayText": "駐車場及びアクセス方法", "label": "　" }
        }
    	]
		};
		
  	// リッチメニューを作りIdをもらう
  	const bRichMenuId = await lineCreateRichMenu(channelAccessToken, menuConfig);
  	return bRichMenuId;
  	
	} catch (error) {
    console.error('bRichMenuId(Yoichi) 作成エラー:', error);
		return null;
  }  
  
}


// //////////////////////////////////////////////////
// バイナリファイル(jpg)が正しいかチェック
// //////////////////////////////////////////////////
async function checkJpegMagicNumbers(filePath) {
  const buffer = await fs.readFile(filePath); // 非同期読み込み

  const start = buffer.slice(0, 2).toString("hex").toUpperCase();
  const end = buffer.slice(-2).toString("hex").toUpperCase();

  console.log(`🔍 先頭: ${start}, 末尾: ${end}`);
  if (start === "FFD8" && end === "FFD9") {
    console.log("✅ JPEG形式のバイナリとして正しいです。");
  } else {
    console.error("❌ JPEG形式として不正です。画像破損または形式ミスマッチの可能性があります。");
  }
}


// //////////////////////////////////////////////////
// 部品：リッチメニューを作成する
// //////////////////////////////////////////////////
async function lineCreateRichMenu(channelAccessToken, menuConfig) {
  const res = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(menuConfig),
  });

  if (!res.ok) {
    console.error(`❌ リッチメニュー作成失敗: ${res.status} - ${await res.text()}`);
    return null;
  }

  const json = await res.json();
  console.log(`📦 リッチメニュー作成成功: richMenuId = ${json.richMenuId}`);
  return json.richMenuId;
}


// //////////////////////////////////////////////////
// 部品：画面をアップロードする
// //////////////////////////////////////////////////
/**
 * リッチメニュー画像をLINEにアップロードする関数（Cloudflare Workers 向け）
 *
 * @param {string} channelAccessToken - LINEチャネルアクセストークン
 * @param {string} richMenuId - 対象のリッチメニューID
 * @param {Uint8Array} imageBuffer - JPEG画像データ
 * @returns {Promise<boolean>} 成功なら true
 */
export async function lineUploadRichMenuImage(channelAccessToken, richMenuId, imageBuffer) {
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": "image/jpeg",
      },
      body: Buffer.from(imageBuffer), // Uint8Array でも OK
    });

    const resText = await res.text();

    if (res.ok) {
      console.log(`🖼️ 画像アップロード成功: richMenuId=${richMenuId}`);
      if (resText) {
        console.log("📦 レスポンス内容:", resText);
      } else {
        console.log("📭 空のレスポンスが返されました（問題なし）");
      }
      return true;
    } else {
      console.error(`❌ アップロード失敗: ${res.status} ${res.statusText}`);
      console.error("📦 レスポンス内容:", resText);
      return false;
    }
  } catch (error) {
    console.error(`❌ fetch実行中に例外が発生しました: ${error.message || error}`);
    return false;
  }
}


// //////////////////////////////////////////////////
// 部品：エイリアスを定義する(タブの行き来ができるようにする)
// //////////////////////////////////////////////////
async function lineRegisterRichMenuAlias(channelAccessToken, richMenuId, aliasId) {
  const res = await fetch("https://api.line.me/v2/bot/richmenu/alias", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      richMenuAliasId: aliasId,
      richMenuId: richMenuId,
    }),
  });

  if (res.ok) {
    console.log(`🔗 エイリアス ${aliasId} を登録しました：richMenuId = ${richMenuId}`);
    return true;
  } else {
    console.error(`❌ エイリアス ${aliasId} の登録失敗: ${res.status} - ${await res.text()}`);
    return false;
  }
}


// //////////////////////////////////////////////////
// 部品：既定値のタブ(画面A)を定義する(どちらを先に開くか)
// エラー時に戻る値は次の通り
//  400 Bad Request（存在しない richMenuId など）
//  401 Unauthorized（アクセストークンが無効）
//  403 Forbidden（Bot がその操作を許可されていない）
//  404 Not Found（対象ユーザーが見つからないなど）
// //////////////////////////////////////////////////
async function lineSetDefaultRichMenu(channelAccessToken, richMenuId) {
  const res = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
    },
  });

  if (!res.ok) {
    console.error(`画面Aの既定値設定エラー: ${res.status} - ${await res.text()}`);
		return false;
  }

  return true; // 成功したら true を返す
}


