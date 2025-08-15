// handlers/events.js

import { sendReplyMessage, getUserProfile } from "../lib/lineApiHelpers.js";
import { isCongested, setFlagKVSB } from "../lib/kvUtils.js";
import { createMessages } from "../richmenu-manager/data/messages.js";
import { getEnv } from "../lib/env.js";


/**
 * LINEからのイベントをイベント内容によって振り分けて処理する
 * event処理をする場合は、index.jsにイベント内容を定義するのを忘れないこと
 * event処理をしないイベントとは、無視やコンソールログを出すだけしか処理しないイベントのこと
 * @param {object} event - LINE Webhook Event
 * @param {object} env - 環境変数
 */
export async function handleEvent(event, env, ctx) {
  const { msgCongested } = createMessages(env);
  const { isProd } = getEnv(env);

  // ✅ 最初に混雑チェック（KV日次フラグを読み込む）
  const congested = await isCongested(env);
  if (congested) { // 混雑中(true)だったら混雑中メッセージを出力してリターン
    // ✅ message.text または postback.data を取得（両方なければ ""）
    const pbData = event.postback?.data || "";    // postback event
    const textData = event.message?.text || "";   // message event
    const data = (pbData || textData);

    const replyToken = event && typeof event.replyToken === "string" ? event.replyToken : "";

    let msg;

    // タブ切り替えの時は今は何もしない
    if (pbData === "change to A" || pbData === "change to B") return;

    // 相手の混雑状況に合わせるコマンド("kv80", "kv90", "kv100", "kvdel", "sb90")入力時は
    // 専用関数にまかせる
    const isCommand = await handleThresholdCommand(data, event, env, ctx);
    if (isCommand) return;

    // 通常は混雑メッセージを返す
    msg =  [{ type: "text", text: msgCongested }];

    // 返信は必ず「今ここで」終わらせる（waitUntilに入れない）
    if (replyToken.length > 0) {
      try {
        await sendReplyMessage(replyToken, msg, env);
      } catch(err) {
        console.error(`⚠️ ${event.type} で reply メッセージ送信に失敗しました:`, err);
      };

    } else {
      console.error(`⚠️ ${event.type} で replyToken が空のため reply をスキップしました`);
    }

    return;  // 混雑中なのでそれ以降の処理はせずリターンする

  }

  // 通常処理
  switch ( event.type ) {
    case 'postback':
      await handlePostbackEvent(event, env, ctx);
      break;

    case 'message':
      await handleMessageEvent(event, env, ctx);
      break;

    case 'follow':
      await handleFollowEvent(event, env);
      break;

    case 'unfollow':
      if (!isProd) console.log("🔕 ブロックされました:", event.source?.userId);
      break;

    case 'join':
      if (!isProd) console.log("🚪 グループに参加しました:", event.source?.groupId || event.source?.roomId);
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
      break;
  }

  // ✅ Supabase書き込みは、index.jsが非同期で「裏に投げる」ので
  // ここでは何もせずリターンするだけ。

}



/**
 * 相手側Workerの混雑状況に合わせるコマンドを処理する
 * @param {string} data - kv80 / kv90 / kv100 / kvdel / sb90
 * @param {object} env - 環境変数
 * @param {object} ctx - index.js でfetch使った時に貰える特別なパラメータ
 * @returns true/false
 */
// ✅ 「しきい値コマンド」を処理する関数（"kv80" など）
async function handleThresholdCommand(data, event, env, ctx) {
  const { isProd } = getEnv(env);
  const eventType =  event && event.type ? event.type : "unknown";

  const cmd = typeof data === "string" ? data.toLowerCase().trim() : "";
  if (!["kv80", "kv90", "kv100", "kvdel", "sb90"].includes(cmd)) return false;

  const replyToken = event && typeof event.replyToken === "string" ? event.replyToken : "";


  const displayName = {
    kv80:  "KV日次件数しきい値80%",
    kv90:  "KV日次件数しきい値90%",
    kv100: "KV日次件数しきい値100%",
    kvdel: "KV日次件数のリセット",
    sb90:  "Supabase月次件数しきい値90%"
  }[cmd] || cmd;

  const msg = [{ type: "text", text:  `${displayName} を受け付けました。` }];

  // フラグ処理は裏へ（ctx.waitUntilで非同期処理）
  ctx.waitUntil(setFlagKVSB(env, cmd).catch(function (err) {
    if (!isProd) console.warn(`${cmd} コマンドの処理に失敗しました:`, err);
  }));

  // 返信は必ず「今ここで」終わらせる（waitUntilに入れない）
  if (replyToken.length > 0) {
    try {
      await sendReplyMessage(replyToken, msg, env);
    } catch (err) {
      if (!isProd) console.warn(eventType + " で reply メッセージ送信に失敗しました:", err);
    }

  } else {
    console.error("⚠️ replyToken が空のため reply をスキップしました（" + cmd + "）");
  }

  return true;
}



// ///////////////////////////////////////////
// followイベントの処理（書き込みはリターンして非同期で実行）
async function handleFollowEvent(event, env) {
  const { textTemplates } = createMessages(env);
  const userId = event.source?.userId ?? null;
  const eventType = "follow";

  const replyToken = event && typeof event.replyToken === "string" ? event.replyToken : "";

  const { isProd } = getEnv(env);


  // ✅ 1. ユーザープロフィール取得（awaitする）
  let profile = null;
  try {
    profile = await getUserProfile(userId, env);
  } catch (err) {
    if (err.statusCode === 403) {
      if (!isProd) console.warn(`⚠️ ユーザープロフィール取得で 403 userId=${userId}`, err);
    } else {
      console.error("❌ ユーザープロフィール取得エラー", err);
    }
  }

  // 名前が取れなければ固定文章
  const name = profile?.displayName || "お客様";
  const followText = textTemplates["msgFollow"];

  const mBody = (name.includes("$"))  ?  `お客様、${followText}`  :  `${name}さん、${followText}`;


  // ✅ 2. ウェルカムメッセージ作成
  let msg;
  try {
    msg = buildEmojiMessage("msgFollow", env, mBody);
  } catch (error) {
    if (!isProd) console.log(`⚠️ ${eventType} 絵文字メッセージの構築失敗: ${error.message}`);
    const greetingMessage = "お客様、はじめまして！\nお友だち追加ありがとうございます！\nこのアカウントでは最新情報を定期的に配信して参ります。\n" +
                            "どうぞお楽しみに！\n\nメニューが表示されない場合、いったんトーク画面を閉じて再度開いてくださいね！";
    msg = { type: "text", text: greetingMessage };
  }

  // ✅ 3. LINE返信を送る
  if (replyToken.length > 0) {
    try {
      await sendReplyMessage(replyToken, [msg], env);
      if (!isProd) console.log("✅ ${eventType} で 挨拶メッセージ送信に成功しました。");
    } catch(err) {
      if (!isProd) console.warn(`⚠️ ${eventType} で 挨拶(reply)メッセージ送信に失敗しました:`, err);
    };

  } else {
    console.error(`⚠️ ${eventType} で replyToken が空のため reply をスキップしました`);
  }


  // 非同期処理なのでリターンコードは無視されて上位で常に200にされる

}



// ///////////////////////////////////////////
// messageイベントの処理（Supabase書き込みは非同期で裏に回す）
async function handleMessageEvent(event, env, ctx) {
  const { lineQRMessages, msgY, msgPostpone } = createMessages(env);
	const { isProd } = getEnv(env);
  const sourceType = event.source?.type ?? null;  // 'user' | 'group' | 'room'

  const replyToken = event && typeof event.replyToken === "string" ? event.replyToken : "";

  let  data = event.message?.text || "";   // message event
  data = data.toLowerCase().trim();

  const eventType = "message";
  let msg;

  // ✅ 1. グループ・ルームからのメッセージは特定のワード(上記)以外は無視
  // LINE公式アカウントの「自動応答対象ワード」のみBotが代わりに返信
  if (sourceType === "group" || sourceType === "room") {
    if (data === "友だち追加" || data === "qrコード" ) {
      msg = lineQRMessages;
    }
    else if (await handleThresholdCommand(data, event, env, ctx)) {
      return;
    }
    else {
      return;
    }
  }

  // ✅ 2. 個人チャットの応答メッセージ生成
  else {
    if (data === "友だち追加" || data === "qrコード" ) {
      msg = lineQRMessages;
    }
    else if (await handleThresholdCommand(data, event, env, ctx)) {
      return;
    }
    else if (data === "ワイワイ") {
      msg = [{ type: "text", text: msgY }];
    }
    else {
      msg = [{ type: "text", text: msgPostpone }];
    }
  }


  // ✅ 3. LINE応答
  if (replyToken.length > 0) {
    try {
      await sendReplyMessage(replyToken, msg, env);
    } catch(err) {
      if (!isProd) console.warn(`⚠️ ${eventType} で reply メッセージ送信に失敗しました:`, err);
    };

  } else {
    console.error(`⚠️ ${eventType} で replyToken が空のため reply をスキップしました`);
  }

  // 非同期処理(Supabaseは裏に回す)のでリターンコードはいつも200

}



// ///////////////////////////////////////////
// メニュータップ時に通知されるpostback処理を行う
async function handlePostbackEvent(event, env, ctx) {
  const data   = event.postback?.data;
  const { isProd } = getEnv(env);
  const eventType = "postback";

  const replyToken = event && typeof event.replyToken === "string" ? event.replyToken : "";


  // ✅ 1. 混雑時に自分にも同様の混雑状況を作る
  if (await handleThresholdCommand(data, event, env, ctx)) return;

  // ✅ 2. タブ切り替え系（今は何もしない）
  if (data === "change to A" || data === "change to B") return;

  // ✅ 3. メニュータップ系の返信処理（awaitで応答を待つ）
  if (data.startsWith("tap_richMenu")) {
    try {
      await handleRichMenuTap(data, replyToken, env);
    } catch (err) {
      if (!isProd) console.warn(`⚠️ ${eventType} メニュータップ応答に失敗しました:`, err);
    }
  }

}



// ///////////////////////////////////////////
// リッチメニュータップのバッチ処理
async function handleRichMenuTap(data, replyToken, env) {
  const { mediaMessages, textMessages, textTemplates } = createMessages(env);
  let messages = [];
  let carouselFlg = false;
  const eventType = "postback";

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
  else if (data == "tap_richMenuB3y") {
    carouselFlg = true;
    messages = setPandRCarouselMessageYoichi(env);
  }
  else if (data == "tap_richMenuB6y") {
    carouselFlg = true;
    messages = setMapCarouselMessageYoichi(env);
  }

  const { isProd } = getEnv(env);

  try {
    if (textTemplates[data]) {
      const emojiTextMessage = buildEmojiMessage(data, "");
      messages.push(emojiTextMessage);
    }
  } catch (error) {
    if (!isProd) console.warn(`⚠️ ${eventType} 絵文字メッセージの構築失敗: ${error.message}`);
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

  // 送信
  if (replyToken.length > 0) {
    try {
      await sendReplyMessage(replyToken, messages, env);
    } catch(err) {
      if (!isProd) console.warn(`⚠️ ${eventType} で reply メッセージ送信に失敗しました:`, err);
    };

  } else {
    console.error(`⚠️ ${eventType} で replyToken が空のため reply をスキップしました`);
  }

}



// ///////////////////////////////////////////
// joinイベント（グループやルームに招待されたときの挨拶）
// 多分だせないのであきらめる
async function handleJoinEvent(event, env) {
  const { msgJoin } = createMessages(env);
  const { isProd } = getEnv(env);
  const eventType = "join";

  const replyToken = event && typeof event.replyToken === "string" ? event.replyToken : "";
  // ✅ 仲間に入れてくれてありがとうメッセージの送信
  if (replyToken.length > 0) {
    const msg = [{ type: "text", text: msgJoin }];
    try {
      await sendReplyMessage(replyToken, msg, env);
    } catch(err) {
      if (!isProd) console.warn(`⚠️ ${eventType} で reply メッセージ送信に失敗しました:`, err);
    };

  } else {
    console.error(`⚠️ ${eventType} で replyToken が空のため reply をスキップしました`);
  }


  // Supabase書き込み処理は行わない（userIdがnullのときがあるから）

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
// P&R(パークアンドライド)をカルーセルメッセージにする(夜市)
function setPandRCarouselMessageYoichi(env) {
  const { msgB31y, msgB32y } = createMessages(env);

  const textMessageA3 = [
    { type: "text", text: msgB31y },
    { type: "text", text: msgB32y }
  ];

  const { baseDir } = getEnv(env);

  const flex_message1 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel_yoichi/y_pandr1.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr1.jpg`
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
      url: `${baseDir}carousel_yoichi/y_pandr2.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr2.jpg`
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
      url: `${baseDir}carousel_yoichi/y_pandr3.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr3.jpg`
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
      url: `${baseDir}carousel_yoichi/y_pandr4.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr4.jpg`
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
      url: `${baseDir}carousel_yoichi/y_pandr5.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr5.jpg`
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
      url: `${baseDir}carousel_yoichi/y_pandr6.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr6.jpg`
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
      url: `${baseDir}carousel_yoichi/y_pandr7.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr7.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message8 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel_yoichi/y_pandr8.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr8.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message9 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel_yoichi/y_pandr9.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr9.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };

  const flex_message10 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel_yoichi/y_pandr10.jpg`,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_pandr10.jpg`
      }
    },
    styles: {
      body: {
        backgroundColor: "#75BF82"
      }
    }
  };


  const carouselContents1 = [flex_message1, flex_message2, flex_message3, flex_message4, flex_message5, flex_message6];
  const carouselContents2 = [flex_message7, flex_message8, flex_message9, flex_message10];

  const flexMessage1 = {
    type: "flex",
    altText: "ParkAndRide",
    contents: {
      type: "carousel",
      contents: carouselContents1
    }
  };
  const flexMessage2 = {
    type: "flex",
    altText: "ParkAndRide",
    contents: {
      type: "carousel",
      contents: carouselContents2
    }
  };


  // textMessage が配列ならそのまま使う、単体なら配列に包む(今は全部配列なので不要)
  // const textMessagesArray = Array.isArray(textMessage) ? textMessage : [textMessage];

  // ✅ テキストの配列を展開して、
  // 最終的に [ text, text, ～, flex ] (全体を配列にする)形式にまとめて返す
  return [...textMessageA3, flexMessage1, flexMessage2];

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
    altText: "ParkAndRide",
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
// MAP(会場マップ/ショップリスト)をカルーセルメッセージにする(夜市)
function setMapCarouselMessageYoichi(env) {
  const { msgB6y } = createMessages(env);

  const textMessageB6y = [
    { type: "text", text: msgB6y }
  ];

  const { baseDir } = getEnv(env);

  const flex_message1 = {
    type: "bubble",
    hero: {
      type: "image",
      url: `${baseDir}carousel_yoichi/y_map1.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_map1.jpg`
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
      url: `${baseDir}carousel_yoichi/y_map2.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_map2.jpg`
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
      url: `${baseDir}carousel_yoichi/y_map3.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_map3.jpg`
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
      url: `${baseDir}carousel_yoichi/y_map4.jpg`,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "cover",
      action: {
        type: "uri",
        uri: `${baseDir}carousel_yoichi/y_map4.jpg`
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
  return [...textMessageB6y, flexMessage];

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



