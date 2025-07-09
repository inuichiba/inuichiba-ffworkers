// handlers/events.js
// ✅ 最新版：events.js

import { saveUserProfileAndWrite } from"../lib/saveUserInfo.js";
import { sendReplyMessage, getUserProfile } from"../lib/lineApiHelpers.js";
import { createMessages } from"../richmenu-manager/data/messages.js";
import { getEnv } from "../lib/env.js";

// ///////////////////////////////////////////
// eventタイプで処理を振り分ける
export async function handleEvent(event, env) {

  const { isProd } = getEnv(env);

  switch (event.type) {
    case 'postback':
      await handlePostbackEvent(event, env);
      break;

    case 'message':
      await handleMessageEvent(event, env);
      break;

    case 'follow':
      await handleFollowEvent(event, env);
      break;

    case 'unfollow':
      if (!isProd) console.log("🔕 ブロックされました:", event.source?.userId);
      break;

    case 'join':
      await handleJoinEvent(event, env);
      break;

    case 'leave':
      if (!isProd) console.log("🚪 グループから削除されました:", event.source?.groupId || event.source?.roomId);
      break;

    case 'memberJoined':
      if (!isProd) console.log("👧 誰かがグループに参加しました:", event.source?.groupId || event.source?.roomId);
      break;

    case 'memberLeft':
      if (!isProd) console.log("👋 誰かがグループを退出しました:", event.source?.groupId || event.source?.roomId);
      break;

    default:
      // 未処理イベントだけ本番でも出してみる
      // 多すぎたら対応するか無視するかログを抑制する
      console.log("❓ 未処理イベントタイプ:", event.type);
      return new Response("❓ 未対応のイベント", { status: 400 });
  }

  return new Response("Done", { status: 200 });

}


// ///////////////////////////////////////////
// followイベントの処理（書き込みはあとから実行）
async function handleFollowEvent(event, env) {
  const { textTemplates } = createMessages(env);
  const userId = event.source?.userId ?? null;
  const groupId =
    event.source?.type === "group" ? event.source.groupId :
    event.source?.type === "room"  ? event.source.roomId :
    null;
  const sourceType = event.source?.type ?? null;  // 'user' | 'group' | 'room'
  const eventType = "follow";
  let p3;
  const { isProd } = getEnv(env);

  // --- メッセージ生成＆返信
  // ユーザープロフィールを取得
  const p1 = getUserProfile(userId, env);
  const profile = p1;
  const displayName = profile?.displayName || null;
  const followText = textTemplates["msgFollow"];

  let mBody = (displayName == null || displayName.includes("$"))
    ? followText
    : `${displayName}さん、${followText}`;


  // ウェルカムメッセージを作って送る
  let message;
  try {
    const emojiTextMessage = buildEmojiMessage("msgFollow", env, mBody);
    message = emojiTextMessage;
  } catch (error) {
    if (!isProd) console.warn(`⚠️ follow 絵文字メッセージの構築失敗: ${error.message}`);
    message = { type: "text", text: "エラーが発生しました。" };
  }

  const p2 = sendReplyMessage(event.replyToken, [message], env);


  // --- 書き込みはあとで非同期に（UI優先！）
  // 有償を避けるため follow eventしか書き込まない
  if (userId) {
    try {
      p3 = saveUserProfileAndWrite(userId, groupId, env);
    } catch (err) {
      if (!isProd) console.warn(`⚠️ ${eventType}書き込み失敗: 種別=${sourceType}`, err.message);
    }
  }


  // すべての非同期処理が終わるのを待つ
  const promises = [];

  if (typeof p1 !== "undefined") promises.push(p1);
  if (typeof p2 !== "undefined") promises.push(p2);
  if (typeof p3 !== "undefined") promises.push(p3);

  try {
    // 📌 現在は Promise の戻り値（results）は使用していないが、
    //    将来的に各処理（p1/p2/p3など）の結果を個別に使う可能性がある。
    //    必要になったら const results = await Promise.all(promises); に戻すこと。
    await Promise.all(promises);
  } catch (err) {
    if (!isProd) console.warn(`⚠️ ${eventType}イベントでエラーが発生しました。処理は中断されました: 種別=${sourceType}`, err);
    return new Response(`${eventType} NG`, { status: 400 });
  }

  return new Response(`${eventType} OK`, { status: 200 });

}


// ///////////////////////////////////////////
// messageイベントの処理（書き込みは後ろで非同期）
async function handleMessageEvent(event, env) {
  const { lineQRMessages, msgY, msgPostpone } = createMessages(env);
	const userId = event.source?.userId ?? null;
	const sourceType = event.source?.type ?? null;  // 'user' | 'group' | 'room'
  const groupId =
    event.source?.type === "group" ? event.source.groupId :
    event.source?.type === "room"  ? event.source.roomId :
    null;
  const data = event.message.text;
  const eventType = "message";
	let message = [];
  let p1, p2;


	// LINE公式アカウントの「自動応答対象ワード」はBotが代わりに返信
	if (data === "QRコード" || data === "友だち追加") {
    message = lineQRMessages;
    p1 = sendReplyMessage(event.replyToken, message, env);
  }
	// グループ or ルームからのメッセージは、LINE自動応答メッセージのみBotの代わりに返信
	// 他は完全に無視
	else if (sourceType === "group" || sourceType === "room") {
    return new Response(`${eventType} OK`, { status: 200 });
  }
  // 以下は「個人チャット」で、自動応答以外のメッセージ
	else if (data === "ワイワイ") {
    message = [{ type: "text", text: msgY }];
    p1 = sendReplyMessage(event.replyToken, message, env);
  }
  // 上記すべてに該当しない場合
	else {
    message = [{ type: "text", text: msgPostpone }];
    p1 = sendReplyMessage(event.replyToken, message, env);
  }

  // --- Supabase書き込みはメッセージ送信後、後回しに実行（非同期）
  const { isProd } = getEnv(env);

  if (userId) {
    try {
      p2 = saveUserProfileAndWrite(userId, groupId, env);
    } catch (err) {
      if (!isProd) console.warn(`⚠️ ${eventType}書き込み失敗: 種別=${sourceType}`, err.message);
      return new Response(`${eventType} NG`, { status: 400 });
    }
  }

  // すべての非同期処理が終わるのを待つ
  const promises = [];

  if (typeof p1 !== "undefined") promises.push(p1);
  if (typeof p2 !== "undefined") promises.push(p2);

  try {
    // 📌 現在は Promise の戻り値（results）は使用していないが、
    //    将来的に各処理（p1/p2/p3など）の結果を個別に使う可能性がある。
    //    必要になったら const results = await Promise.all(promises); に戻すこと。
    await Promise.all(promises);
  } catch (err) {
    if (!isProd) console.warn(`⚠️ ${eventType}イベントでエラーが発生しました。処理は中断されました: 種別=${sourceType}`, err);
    return new Response(`${eventType} NG`, { status: 400 });
  }

  return new Response(`${eventType} OK`, { status: 200 });

}


// ///////////////////////////////////////////
// メニュータップ時に通知されるpostback処理を行う
async function handlePostbackEvent(event, env) {
  const data = event.postback.data;
	const userId = event.source?.userId ?? null;
	const sourceType = event.source?.type ?? null;  // 'user' | 'group' | 'room'
  const groupId =
    event.source?.type === "group" ? event.source.groupId :
    event.source?.type === "room"  ? event.source.roomId :
    null;
  const eventType = "postback";
  let p1, p2;

  // --- A. メニュータップ系（返信処理）
  if (data.startsWith("tap_richMenu")) {
    p1 = await handleRichMenuTap(data, event.replyToken, env);
  }

  // --- B. タブ切り替えなど、今は何もしないケース
  // タブ切り替え。安定したのでログ不要
  if (data === "change to A" || data === "change to B") {
    // if (!isProd) console.log("🔁 タブ切り替え postback 受信（許可）:", data);
    return new Response("Postback OK", { status: 200 });
  }

  // --- C. 書き込み処理
  // --- Supabase書き込みはメッセージ送信後、後回しに実行（非同期）
  const { isProd } = getEnv(env);

  if (userId) {
    try {
      p2 = saveUserProfileAndWrite(userId, groupId, env);
    } catch (err) {
      if (!isProd) console.warn(`⚠️ ${eventType}書き込み失敗: 種別=${sourceType}`, err.message);
      return new Response(`${eventType} NG`, { status: 400 });
    }
  }

  // すべての非同期処理が終わるのを待つ
  const promises = [];

  if (typeof p1 !== "undefined") promises.push(p1);
  if (typeof p2 !== "undefined") promises.push(p2);

  try {
    // 📌 現在は Promise の戻り値（results）は使用していないが、
    //    将来的に各処理（p1/p2/p3など）の結果を個別に使う可能性がある。
    //    必要になったら const results = await Promise.all(promises); に戻すこと。
    await Promise.all(promises);
  } catch (err) {
    if (!isProd) console.warn(`⚠️ ${eventType}イベントでエラーが発生しました。処理は中断されました: 種別=${sourceType}`, err);
    return new Response(`${eventType} NG`, { status: 400 });
  }

  return new Response(`${eventType} OK`, { status: 200 });

}


// ///////////////////////////////////////////
// リッチメニュータップのバッチ処理
async function handleRichMenuTap(data, replyToken, env) {
  const { mediaMessages, textMessages, textTemplates } = createMessages(env);
  let messages = [];
  let carouselFlg = false;

  if (textMessages[data]) {
    messages = textMessages[data];
  } else if (mediaMessages[data]) {
    messages = mediaMessages[data];
  }
  // フレックスメッセージはテキストとフレックスが配列じゃなく展開されてくるので、
  // そのままま全部受け取る
  else if (data == "tap_richMenuA2" || data == "tap_richMenuB2") {
    carouselFlg = true;
    messages = setMannerCarouselMessage(env);
  }
  else if (data == "tap_richMenuA3" || data == "tap_richMenuB3") {
    carouselFlg = true;
    messages = setPandRCarouselMessage(env);
  }
  else if (data == "tap_richMenuA5") {
    carouselFlg = true;
    messages = setDogRunCarouselMessage(env);
  }
  else if (data == "tap_richMenuA6" || data == "tap_richMenuB6") {
    carouselFlg = true;
    messages = setMapCarouselMessage(env);
  }
  else if (data == "tap_richMenuA7" || data == "tap_richMenuB7") {
    carouselFlg = true;
    messages = setParkingCarouselMessage(env);
  }


  const { isProd } = getEnv(env);

  try {
    if (textTemplates[data]) {
      const emojiTextMessage = buildEmojiMessage(data, "");
      messages.push(emojiTextMessage);
    }
  } catch (error) {
    if (!isProd) console.warn(`⚠️ message 絵文字メッセージの構築失敗: ${error.message}`);
  }


  // カルーセルメッセージか？
  if (carouselFlg) {
    // フレックスメッセージ部分だけを入れる
    const flexMsg = messages.find(m => m.type === "flex");

    if (flexMsg) {
      if (!isProd) console.log("📦 Flex Message 部分:", JSON.stringify(flexMsg, null, 2));
    } else {
      console.error("❌ Flex Message が見つかりません（type:flex がありません）");
    }
    if (!isProd) console.log("🚀 送信するメッセージ一覧:", JSON.stringify(messages, null, 2));
  } else {
    // 配列で初期化してればいきなり0かと聞いても大丈夫(配列が0個と返すから)
    if (messages.length > 0 && !isProd) {
      console.log("Reply Token:", replyToken);
      console.log("送信メッセージ:", JSON.stringify(messages, null, 2));
    }
  }


  // 送信(Supabase書き込みは呼び出し側で行う)
  await sendReplyMessage(replyToken, messages, env);

}


// ///////////////////////////////////////////
// joinイベント（グループやルームに招待されたときの挨拶）
async function handleJoinEvent(event, env) {
    const { msgJoin } = createMessages(env);
  const userId = event.source?.userId ?? null;
  const groupId =
    event.source?.type === "group" ? event.source.groupId :
    event.source?.type === "room"  ? event.source.roomId :
    null;
  const sourceType = event.source?.type ?? null;  // 'user' | 'group' | 'room'
  const eventType = "join";
  let p2;

  const { isProd } = getEnv(env);

  const welcomeMessage = { type: "text", text: msgJoin };
  const p1 = sendReplyMessage(event.replyToken, [welcomeMessage], env);

  if (userId) {
    try {
      p2 = saveUserProfileAndWrite(userId, groupId, env);
    } catch (err) {
      if (!isProd) console.warn(`⚠️ ${eventType}書き込み失敗: 種別=${sourceType}`, err.message);
      return new Response(`${eventType} NG`, { status: 400 });
    }
  }

  // すべての非同期処理が終わるのを待つ
  const promises = [];

  if (typeof p1 !== "undefined") promises.push(p1);
  if (typeof p2 !== "undefined") promises.push(p2);

  try {
    // 📌 現在は Promise の戻り値（results）は使用していないが、
    //    将来的に各処理（p1/p2/p3など）の結果を個別に使う可能性がある。
    //    必要になったら const results = await Promise.all(promises); に戻すこと。
    await Promise.all(promises);
  } catch (err) {
    if (!isProd) console.warn(`⚠️ ${eventType}イベントでエラーが発生しました。処理は中断されました: 種別=${sourceType}`, err);
    return new Response(`${eventType} NG`, { status: 400 });
  }

  return new Response(`${eventType} OK`, { status: 200 });

}


// /////////////////////////////////////////
// 絵文字入りメッセージを組み立てる
function buildEmojiMessage(templateKey, env, mBody) {
  const { textTemplates, emojiMap } = createMessages(env);
  let rawText = textTemplates[templateKey];
  const emojiList = emojiMap[templateKey];

  if (templateKey === "msgFollow") {
    rawText = mBody;
  }

  if (!rawText) {
    throw new Error(`テキストテンプレートが見つかりません: ${templateKey}`);
  }

  const placeholderCount = (rawText.match(/\$/g) || []).length;
  const { isProd } = getEnv(env);

  if (!isProd) {
    console.log("💡 placeholderCount ($の数):", placeholderCount);
    console.log("🔢 emojiList.length:", emojiList ? emojiList.length : 0);
  }

  if (!emojiList || placeholderCount !== emojiList.length) {
    throw new Error(`$の数(${placeholderCount})とemojiListの数(${emojiList ? emojiList.length : 0})が一致しません: ${templateKey}`);
  }

  const emojis = [];
  let i = 0;
  let placeholderIndex = rawText.indexOf('$');

  while (placeholderIndex !== -1) {
    emojis.push({
      index:     placeholderIndex,
      productId: emojiList[i].productId,
      emojiId:   emojiList[i].emojiId
    });

    placeholderIndex = rawText.indexOf("$", placeholderIndex + 1);
    i++;
  }

  if (!isProd) {
    console.log("📦 最終構築される emojis 配列:", emojis);
    console.log("✅ 最終返却メッセージ:", {
      type: "text",
      text: rawText,
      emojis: emojis
    });
  }

  return {
    type: "text",
    text: rawText,
    emojis: emojis
  };
}


// ----------- ↓ ここからカルーセルメッセージたち ↓ -----------
// /////////////////////////////////////////////
// GOOD MANNERSをカルーセルメッセージにする
function setMannerCarouselMessage(env) {
  const { msgA20, msgA21, msgA22, msgA23 } = createMessages(env);

  const textMessageA2 = [
    { type: "text", text: msgA20 }
  ];

  const { baseDir } = getEnv(env);

  const flex_message1 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "📌 ご来場時のお願い",
          weight: "bold",
          size: "xl",
          wrap: true
        },
        {
          type: "text",
          text: msgA21,
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}rules/rules_arrival.jpg`
          },
          style: "secondary",
          color: "#C8E6C9", // グリーン（ボタン）
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9" // 薄いグリーン（バブル背景）
      }
    }
  };

  const flex_message2 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "🐾 ワンちゃんとの過ごし方",
          weight: "bold",
          size: "xl",
          wrap: true
        },
        {
          type: "text",
          text: msgA22,
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}rules/rules_dog.jpg`
          },
          style: "secondary",
          color: "#FFD180", // オレンジ（ボタン）
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#FFF3E0" // 薄いオレンジ（バブル背景）
      }
    }
  };

  const flex_message3 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "📌 立ち話・撮影のマナー",
          weight: "bold",
          size: "xl",
          wrap: true
        },
        {
          type: "text",
          text: msgA23,
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}rules/rules_manner.jpg`
          },
          style: "secondary",
          color: "#C8E6C9", // グリーン（ボタン）
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9" // 薄いグリーン（バブル背景）
      }
    }
  };

  const flexMessage = {
    type: "flex",
    altText: "グッドマナー",
    contents: {
      type: "carousel",
      contents: [flex_message1, flex_message2, flex_message3]
    }
  };


  // textMessage が配列ならそのまま使う、単体なら配列に包む(今は全部配列なので不要)
  // const textMessagesArray = Array.isArray(textMessage) ? textMessage : [textMessage];

  // ✅ テキストの配列を展開して、
  // 最終的に [ text, text, ～, flex ] (全体を配列にする)形式にまとめて返す
  return [...textMessageA2, flexMessage];

}


// /////////////////////////////////////////////
// ドッグランの留意事項をカルーセルメッセージにする(テキスト版)
function setDogRunCarouselMessage(env) {
  const { msgA50, msgA51, msgA52, msgA53, msgA54, msgA55, msgA56, msgA57, msgA58, msgA59 } = createMessages(env);

  const textMessageA5 = [
    { type: "text", text: msgA50 }
  ];

  const { baseDir } = getEnv(env);

  const flex_message1 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "📌  ドッグランをご利用いただくにあたり",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: "ドッグラン専用入場リストバンドがありませんとご利用できません",
          color: "#FF0000",
          size: "md",
          wrap: true
        },
        {
          type: "text",
          text: "料金：1頭 500円",
          weight: "bold",
          size: "md",
          wrap: true
        },
        {
          type: "text",
          text: "ご利用になる皆さまには皆さまが安全に楽しくご利用いただくためのルールがございますのでご確認をお願い申し上げます。",
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun1.jpg`
          },
          style: "secondary",
          color: "#C8E6C9",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9"
      }
    }
  };

  const flex_message2 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "🐾 ドッグランをご利用いただくにあたり【利用規約】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA51,
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun2.jpg`
          },
          style: "secondary",
          color: "#ffd180",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#fff3E0"
      }
    }
  };

  const flex_message3 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "🐾 ドッグランをご利用いただくにあたり【利用規約】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA52,
          size: "md",
          color: "#FF0000",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun3.jpg`
          },
          style: "secondary",
          color: "#FFD180",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#FFF3E0"
      }
    }
  };

  const flex_message4 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "🐾 ドッグランをご利用いただくにあたり【利用規約】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA53,
          size: "md",
          color: "#FF0000",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun4.jpg`
          },
          style: "secondary",
          color: "#FFD180",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#FFF3E0"
      }
    }
  };

  const flex_message5 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "📌 ドッグランをご利用いただくにあたり【注意事項】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA54,
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun_warning1.jpg`
          },
          style: "secondary",
          color: "#C8E6C9",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9"
      }
    }
  };

  const flex_message6 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "📌 ドッグランをご利用いただくにあたり【注意事項】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA55,
          color: "#FF0000",
          size: "md",
          wrap: true
        },
        {
          type: "text",
          text: msgA56,
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun_warning2.jpg`
          },
          style: "secondary",
          color: "#C8E6C9",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9"
      }
    }
  };

  const flex_message7 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "📌 ドッグランをご利用いただくにあたり【注意事項】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA57,
          size: "md",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun_warning3.jpg`
          },
          style: "secondary",
          color: "#C8E6C9",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9"
      }
    }
  };

  const flex_message8 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "📋 必要な証明書",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "image",
          url: `${baseDir}dogrun/view_dogrun5.jpg`,
          size: "full",
          aspectMode: "fit",
          margin: "md"
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogrun5.jpg`
          },
          style: "secondary",
          color: "#C8E6C9",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9"
      }
    }
  };

  const flex_message9 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "🐾 犬種によるドッグランの分け方【小型犬ゾーン】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA58,
          size: "sm",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogtypes_small.jpg`
          },
          style: "secondary",
          color: "#C8E6C9",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9"
      }
    }
  };

  const flex_message10 = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xl",
      contents: [
        {
          type: "text",
          text: "🐾 犬種によるドッグランの分け方【全犬種ゾーン】",
          weight: "bold",
          size: "lg",
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: msgA59,
          size: "sm",
          wrap: true
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "拡大版はこちら",
            uri: `${baseDir}dogrun/view_dogtypes_all.jpg`
          },
          style: "secondary",
          color: "#C8E6C9",
          height: "sm"
        }
      ]
    },
    styles: {
      body: {
        backgroundColor: "#E8F5E9"
      }
    }
  };


  const carouselContents = [flex_message1, flex_message2, flex_message3, flex_message4, flex_message5,
                            flex_message6, flex_message7, flex_message8, flex_message9, flex_message10];

  const flexMessage = {
    type: "flex",
    altText: "ドッグラン",
    contents: {
      type: "carousel",
      contents: carouselContents
    }
  };


  // textMessage が配列ならそのまま使う、単体なら配列に包む(今は全部配列なので不要)
  // const textMessagesArray = Array.isArray(textMessage) ? textMessage : [textMessage];

  // ✅ テキストの配列を展開して、
  // 最終的に [ text, text, ～, flex ] (全体を配列にする)形式にまとめて返す
  return [...textMessageA5, flexMessage];

}


// /////////////////////////////////////////////
// PARKING(駐車場及びアクセス方法)をカルーセルメッセージにする
function setParkingCarouselMessage(env) {
  const { msgA70, msgA71, msgA72 } = createMessages(env);

  const textMessageA7 =  [
    { type: "text", text: msgA70 },
    { type: "text", text: msgA71 },
    { type: "text", text: msgA72 }
  ];

  const { baseDir } = getEnv(env);

  const flex_message1 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/parking1.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/parking1.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message2 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/parking2.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/parking2.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };


  const carouselContents = [flex_message1, flex_message2];

  const flexMessage = {
    type: "flex",
    altText: "Parking",
    contents: {
      type: "carousel",
      contents: carouselContents
    }
  };


  // textMessage は常に [ {type: text, ～}, {type: text, ～} ] (配列)形式で送ってくる
  // ひとつのメッセージでもいったん配列形式にする
  // そして...(スプレッド構文)をつけることで、textMessage(配列)の内容を展開する
  // 例えばmsga61, msga62, msga63, flexMessage
  // のように展開して順番で受け手側に渡すことができる
  // 後はLINEがテキストならテキスト処理、カルーセルならカルーセル処理を行うだけ

  // textMessage が配列ならそのまま使う、単体なら配列に包む
  // const textMessagesArray = Array.isArray(textMessage) ? textMessage : [textMessage];

  // ✅ テキストの配列を展開して、
  // 最終的に [ text, text, ～, flex ] (全体を配列にする)形式にまとめて返す
  return [...textMessageA7, flexMessage];

}


// /////////////////////////////////////////////
// P&R(パークアンドライド)をカルーセルメッセージにする
function setPandRCarouselMessage(env) {
  const { msgA3 } = createMessages(env);

  const textMessageA3 = [
    { type: "text", text: msgA3 }
  ];

  const { baseDir } = getEnv(env);

  const flex_message1 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/pandr1.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/pandr1.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message2 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/pandr2.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/pandr2.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message3 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/pandr3.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/pandr3.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message4 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/pandr4.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/pandr4.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message5 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/pandr5.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/pandr5.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message6 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/pandr6.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/pandr6.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message7 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/pandr7.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/pandr7.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };


  const carouselContents = [flex_message1, flex_message2, flex_message3, flex_message4, flex_message5, flex_message6, flex_message7];

  const flexMessage = {
    type: "flex",
    altText: "Parking",
    contents: {
      type: "carousel",
      contents: carouselContents
    }
  };


  // textMessage が配列ならそのまま使う、単体なら配列に包む(今は全部配列なので不要)
  // const textMessagesArray = Array.isArray(textMessage) ? textMessage : [textMessage];

  // ✅ テキストの配列を展開して、
  // 最終的に [ text, text, ～, flex ] (全体を配列にする)形式にまとめて返す
  return [...textMessageA3, flexMessage];

}


// /////////////////////////////////////////////
// MAP(会場マップ/ショップリスト)をカルーセルメッセージにする
function setMapCarouselMessage(env) {
  const { msgA6 } = createMessages(env);

  const textMessageA6 = [
    { type: "text", text: msgA6 }
  ];

  const { baseDir } = getEnv(env);

  const flex_message1 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/mapAll.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/mapAll.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#FFFFFF"
      }
    }
  };

  const flex_message2 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/map1.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/map1.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#E3EEF4"
      }
    }
  };

  const flex_message3 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/map2.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/map2.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#E3EEF4"
      }
    }
  };

  const flex_message4 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel/map3.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel/map3.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#E3EEF4"
      }
    }
  };


  const carouselContents = [flex_message1, flex_message2, flex_message3, flex_message4];

  const flexMessage = {
    type: "flex",
    altText: "MAP",
    contents: {
      type: "carousel",
      contents: carouselContents
    }
  };


  // textMessage が配列ならそのまま使う、単体なら配列に包む(今は全部配列なので不要)
  // const textMessagesArray = Array.isArray(textMessage) ? textMessage : [textMessage];

  // ✅ テキストの配列を展開して、
  // 最終的に [ text, text, ～, flex ] (全体を配列にする)形式にまとめて返す
  return [...textMessageA6, flexMessage];

}

