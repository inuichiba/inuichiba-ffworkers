# inuichiba-ffworkers

このリポジトリは、`Cloudflare Workers` を使って LINE BOT などの Webhook 応答を行うためのソースコードをまとめたものです。  
`inuichiba-ffscripts` 配下にある PowerShell/sh スクリプトからこのリポジトリに対して git push し、手動でデプロイする運用を前提としています。

- `inuichiba-ffworkers` … `Cloudflare Workers` 用ソースコード
- `inuichiba-ffimages`  … `cloudflare Pages` 用画像ファイル
- `inuichiba-ffscripts` … 上記向けの `CLIスクリプト群` の保管場所 

---

## 📁 よく使うソースファイルのディレクトリ構成（src/ 以下）
```sh
    src/index.js        # Workers のエントリーポイント
      handlers/         # 各イベント種別（message, postback など）に応じた処理本体
      lib/              # 共通関数（Supabase書き込み、LINE API補助など）
      secrets/          # .env.secrets.ff*.txt を配置（Git除外）
      richmenu-manager/ # タブ付きリッチメッセージの作成(ローカルで実施)
        data/           # メッセージテンプレート、タブ付きメニュー画像
          messages.js   # メッセージテンプレート（メッセージ、postback対応付け、絵文字など）
          *.jpg         # タブ付きメニュー画像(jpg) … jsは見てもわからないので参考として置いておく
          *.js          # タブ付きメニュー画像(Base64に変換したjs) … 実際はこちらが使われる  
```
- その他の主要ファイルは `inuichiba-ffscript` の README.md を参照のこと。 
---

## 📌 運用ポリシー

- `.wrangler.toml` などの Cloudflare Workers 構成ファイルはこのリポジトリに含まれます。
- Secrets系ファイル（`.env.secrets.*.txt`）は `secrets/` に配置し、**Gitには含めません**（`.gitignore` で除外）。
- .backupファイルは `inuichiba-ffworkers`、`inuichiba-ffimages`、`inuichiba-ffscripts` 共通の覚書やバックアップなので Gitには含めません。
- 実行スクリプトは `inuichiba-ffscripts/` リポジトリにまとめてあります。

---

## 📝 メモ

- 本リポジトリは `main` ブランチのみを使って運用します。
- 実行環境ごとに `-env ffdev` （開発環境）- や `-env ffprod` （本番環境）を引数で指定できるようになっています。
- 1行変更するような軽微な修正でも、必ず ffdev で確かめてから ffprod のデプロイを行うよう徹底してください。突然仕様変更されて動かなくなる場合があります。

---

## 🔁 デプロイ

```bash
npx wrangler deploy --env ffdev
npx wrangler deploy --env ffprod
```

---

## LINE Bot の Webhook URL に指定する URL

```sh
ffdev  ： https://inuichiba-ffworkers-ffdev.maltese-melody0655.workers.dev
ffprod ： https://inuichiba-ffworkers-ffprod.maltese-melody0655.workers.dev
```

---

## 📁 よく使うファイル
```sh
src/richmenu-manager/data/messages.js   # テキストを変更
src/richmenu-manager/richMenuHandler.js # メニューの作り替え
src/handlers/events.js                  # FLEX Messageや絵文字などすべてのイベントに対する処理を行う
src/lib/env.js                          # 主に参照。isProd(ffdev/ffprodの切り替え)やSecretsをもらう
```

---

## 📁 リッチメニュー作成について

- リッチメニュー作成はローカルで `inuichiba-ffscripts/ffworkers-run-richmenu.ps1` / `inuichiba-ffscripts/sh/ffworkers-run-richmenu.sh` を実行します
- リッチメニュー作成時のメニュー画像ファイルはローカルのメニュー画像ファイル(jpg)をBase64 jsに変換して使っています
    - 変換するファイルを予め `inuichiba-ffscripts/compress/input` にいれておいてください
    - 変換スクリプトは `inuichiba-ffscripts/compress-images.js` です(Windows/Macどちらも使えます)

---

## SupabaseとKV（概要）
```text
ここでは、Supabase(データベース)とKV(軽量で連打されてもSupabaseに書き込まれる前にはじく機能を持つ)について簡単に説明します。
```

### Supabase（RLS付きPostgreSQL）
- 本プロジェクトでは **ユーザーデータの保存** に使用しています。
- テーブル名：`users_ffprod`（本番）、`users_ffdev`（開発）
- 書き込み処理は `writeUserDataToSupabase.js` から実行されます。
- 本番では `onConflict().ignore()`、開発では `upsert()` を使用。
- RLS（行レベルセキュリティ）を有効化済み。
- Supabaseの書き込みに失敗するとLINE Botの機能の一部に影響します。


### KV（Cloudflare Workers KV）
- Cloudflare Workers からアクセス可能な **キーバリューストア**。
- Supabaseに書き込まれたひとりに対してひとつ作られる。
- Flex Message の出し分けやタップ履歴など、**軽量な一時的データの保存**に使用。
- 保存するキーは文字列、値も文字列やJSON。
- FirebaseやSupabaseと違い、読み書きが非常に高速・安価です。
- そのため、Supabaseに代わり、メニュー連打などのアクセス過多を防ぐ役割を持っています。

