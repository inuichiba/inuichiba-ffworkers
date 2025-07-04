# inuichiba-ffworkers

このリポジトリは、`Cloudflare Workers` を使って LINE BOT などの Webhook 応答を行うためのソースコードをまとめたものです。  
`inuichiba-ffscripts` 配下にあるPowerShellスクリプトなどからこのリポジトリに対して git push する運用を前提としています。
- `inuichiba-ffworkers` … `Cloudflare Workers` 用ソースコード
- `inuichiba-ffimages`  … `cloudflare Pages` 用画像ファイル
- `inuichiba-ffscripts` … 上記向けの `CLIスクリプト群` の保管場所 

---

## 📁 ディレクトリ構成（src/ 以下）
<pre>
  src/index.js        # Workers のエントリーポイント
    handlers/         # 各イベント種別（message, postback など）に応じた処理本体
    lib/              # 共通関数（Supabase書き込み、LINE API補助など）
    secrets/          # .env.secrets.ff*.txt を配置（Git除外）
    richmenu-manager/ # タブ付きリッチメッセージの作成(ローカルで実施)
      data/           # メニュー画像、メッセージテンプレート
        messages.js   # メッセージテンプレート（メッセージ、postback対応付け、絵文字など）
</pre>

---

## 📌 運用ポリシー

- `.wrangler.toml` などの Cloudflare Workers 構成ファイルはこのリポジトリに含まれます。
- Secrets系ファイル（`.env.secrets.*.txt`）は `secrets/` に配置し、**Gitには含めません**（`.gitignore` で除外）。
- .backup系ファイルは `inuichiba-ffworkers`、`inuichiba-ffimages`、`inuichiba-ffscripts` 共通の覚書やバックアップなので Gitには含めません。
- 実行スクリプトは `inuichiba-ffscripts/` リポジトリにまとめてあります。

---

## 📝 メモ

- 本リポジトリは `main` ブランチのみを使って運用します。
- 実行環境ごとに `-env ffdev` や `-env ffprod` を引数で指定できるようになっています。


