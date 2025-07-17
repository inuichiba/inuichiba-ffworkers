//lib/lineApiHelpers.js

import { getEnv } from"./env.js";

// ///////////////////////////////////////////////
// Replyメッセージ送信
export async function sendReplyMessage(replyToken, messages, env) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const { channelAccessToken, isProd } = getEnv(env);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (!isProd) console.warn(`❌ LINEメッセージ送信失敗: ${response.status} - ${errorText}`);
    } else {
      if (!isProd) console.log("✅ LINEメッセージ送信成功");
    }

  } catch (err) {
    console.error("❌ ネットワークエラー:", err.message);
  }

}


// ///////////////////////////////////////////////
// プッシュメッセージ送信
export async function sendPushMessage(userId, messages, env) {
  const url = 'https://api.line.me/v2/bot/message/push';
  const { channelAccessToken, isProd } = getEnv(env);


  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({ to: userId, messages }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (!isProd) console.warn(`❌ PUSHメッセージ送信失敗: ${response.status} - ${errorText}`);
    } else {
      if (!isProd) console.log("✅ PUSHメッセージ送信成功");
    }

  } catch (err) {
    console.error("❌ ネットワークエラー（PUSH）:", err.message);
  }

}


// //////////////////////////////////////////////////
// LINEのユーザプロフィールをまとめて取得する
export async function getUserProfile(userId, env) {
  const { channelAccessToken, isProd } = getEnv(env);
  const url = `https://api.line.me/v2/bot/profile/${userId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${channelAccessToken}`
      }
    });

    if (!response.ok) {
      if (!isProd) {
        const errorText = await response.text();
        console.warn(`❌ ユーザープロフィール取得失敗: ${response.status} - ${errorText}`);
      }
      return null;
    }

    const profile = await response.json();
    if (!isProd) console.log("✅ ユーザープロフィール取得成功:", profile);
    return profile;

  } catch (err) {
    console.error("❌ ネットワークエラー（ユーザープロフィール取得）:", err.message);
    return null;
  }

}
