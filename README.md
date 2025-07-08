# inuichiba-ffworkers

このリポジトリは、`Cloudflare Workers` を使って LINE BOT などの Webhook 応答を行うためのソースコードをまとめたものです。  
`inuichiba-ffscripts` 配下にあるPowerShellスクリプトなどからこのリポジトリに対して git push し、手動でデプロイする運用を前提としています。

- `inuichiba-ffworkers` … `Cloudflare Workers` 用ソースコード
- `inuichiba-ffimages`  … `cloudflare Pages` 用画像ファイル
- `inuichiba-ffscripts` … 上記向けの `CLIスクリプト群` の保管場所 

---

## 📁 ソースファイルのディレクトリ構成（src/ 以下）
```text
  src/index.js        # Workers のエントリーポイント
    handlers/         # 各イベント種別（message, postback など）に応じた処理本体
    lib/              # 共通関数（Supabase書き込み、LINE API補助など）
    secrets/          # .env.secrets.ff*.txt を配置（Git除外）
    richmenu-manager/ # タブ付きリッチメッセージの作成(ローカルで実施)
      data/           # メッセージテンプレート、タブ付きメニュー画像
        messages.js   # メッセージテンプレート（メッセージ、postback対応付け、絵文字など）
        *.jpg         # タブ付きメニュー画像
```

---

## 📌 運用ポリシー

- `.wrangler.toml` などの Cloudflare Workers 構成ファイルはこのリポジトリに含まれます。
- Secrets系ファイル（`.env.secrets.*.txt`）は `secrets/` に配置し、**Gitには含めません**（`.gitignore` で除外）。
- .backupファイルは `inuichiba-ffworkers`、`inuichiba-ffimages`、`inuichiba-ffscripts` 共通の覚書やバックアップなので Gitには含めません。
- 実行スクリプトは `inuichiba-ffscripts/` リポジトリにまとめてあります。

---

## 📝 メモ

- 本リポジトリは `main` ブランチのみを使って運用します。
- 実行環境ごとに `-env ffdev` や `-env ffprod` を引数で指定できるようになっています。

---

## 🔧 初期設定
```bash
brew install git
brew install node
npm install -g wrangler

git clone https://github.com/inuichiba/inuichiba-ffworkers.git
cd inuichiba-ffworkers
wrangler login
```

---

## 🔁 デプロイ
```bash
npx wrangler deploy
```

---

## 📁 よく使うファイル
```text
src/richmenu-manager/data/messages.js   テキストを変更
src/richmenu-manager/richMenuHandler.js メニューの作り替え
src/handlers/events.js                  FLEX Messageや絵文字などすべてのイベントに対する処理を行う
src/lib/env.js                          主に参照。isProd(ffdev/ffprodの切り替え)やSecretsをもらう
```
- 画像はCloudflare Pages側のURLを使っています
- リッチメニュー作成時のメニュー画像ファイルはローカルのメニュー画像ファイルを使っています

## SupabaseのKVについて
暇ができたら書きます。
