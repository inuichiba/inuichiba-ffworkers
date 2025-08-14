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

## 💾 データの保存のしくみ（SupabaseとKVの概要）
```text
このプロジェクトでは、ユーザーの操作履歴などを記録するために **2つの保存場所（データの置き場）** を使っています。ひとつはSupabase(DB：データベース)ともうひとつはKV(軽量で連打されてもSupabaseに書き込まれる前にはじく機能を持つ)です。
```

### KV（Cloudflare Workers KV ： クラウド上のメモ帳のようなもの）
- **一時的なデータ** を保存するために使います。
- たとえば、「この人は今日もうメニューを押したか？」を記録します。
- メニュー連打などで何度もSupabaseのデータを見に行くと **お金がかかりかねない** ため、まずはこのKVを確認します。
- KVはとても **速くて安価** です（クラウド上のメモ帳のようなイメージ）。
- 本番環境の場合、**約1年で自動的に消えます**。開発環境の場合、**約10分で消えます**。
- KV の定義は `wrangler.toml` の `kv_namespaces` で行っています。*.js 上での名称は `usersKV` とし、env.js で isProd フラグを用いて ffprod/ffdev とを切り替えています。

### Supabase（本格的なデータベース）
- ユーザーごとの情報（IDや最終利用日など）を **しっかり記録する場所** です。
- 本番環境のユーザーテーブルは `users-ffprod` です。開発環境は `users-ffdev` です。
- ただし、こちらはアクセスや書き込みのたびに **お金がかかる可能性** があります。
- そのため、できるだけ使わずに済ませる工夫をしています。 
- 📦 実際にはこうなっています：

```markdown
ユーザーが何か操作する
      ↓
  KVに記録がある？
      ┗→ はい（KVの記録は運用中） → 何もしない（Supabaseには行かない）
      ┗→ いいえ（KVは消えている） → Supabase に記録を追加する → KV にも新たに記録を追加する
```

- 現在本番では一度書き込まれたら、もう二度と書き込まないルールになっています。
- （コードには組み込んでいませんが）ユーザーがどんどん増えることによってレコード数が増え、お金がかかりそうになったらSupabase を使った書き込み自体をやめる選択肢もあります。
- ただし今のレコード設計なら、1万ユーザーでデータベースサイズは～4MB（無料枠 500MB に対して約 0.8%）です。inputData などで長いログや長い JSON、画像ファイルなどを入れない限り、無料枠は守られます（他は計算してませんけど）。
- 開発中は確認のため、**10分ごとに書き込みます**（もっと短くしてもいいが、60秒が最低限の値です）。
- データの書き込みは `writeUserDataToSupabase.js` が担当しています。

### 💡 なぜ2つを使い分けているの？

```markdown
項目      KV                    Supabase
用途      一時的な確認用         しっかりした記録用
スピード  非常に高速             やや遅い
コスト    非常に安価（ほぼ無料）  アクセスが多いと課金される可能性
保存期間  約1年（自動削除される） 永続的
```

- このように、**コストとパフォーマンスのバランスを取るため** 2つの保存場所を使い分けています。

### ⚠️ Supabase レコード削除時の注意：KVキーも忘れずに！

- Supabase のユーザーテーブルから **レコードだけを削除する** と、**対応する KV（Key-Value）キーが残ったまま** になります。
- その結果：
    - 同じユーザーが再登録しようとすると、
    - KV にキーがあるため「まだ登録済み」と判断され、追加できなくなります。

#### ✅ 正しい削除方法

ユーザーレコードを削除する際は、**以下の2つを必ず両方行ってください：**

1. Supabase のレコード削除

- 権限があれば Supabase の GUI「Table Editor」から削除可能

2. 対応する KVキーの削除

- Cloudflare ダッシュボード → Storage & Database → KV → 対象のNamespace → KV Pairs
- キー形式は groupId_userId です（例: default_Uxxxxxxxxxxxx）
- 💡 Supabaseだけ削除しても不完全です。KV側の削除を忘れずに！

---

## 使用制限について（KV / Supabase）

```markdown
このプロジェクトでは、Cloudflare Workers の KVストアおよび Supabase を利用していますが、**無課金枠をできるだけ超えないよう使用制限を設けています。**閾値を超えると一部の機能が自動的に制限されます
ただしこれら以外にも無課金枠はあるため、*`inuichiba-ffworkers/usage-dashboard.html`* を**毎日チェックしてください**

```

### 🔐 使用しているKVキーの種類と用途

```markdown
キー名フォーマット（※1）         用途                                      TTL（※2）
groupId_userId                  ユーザーデータのSupabaseアクセススキップ時間 ffdev:10分/ffprod:永続
writeCount:ffprod:YYYY-MM       Supabase月次件数（Supabaseアクセス）       ffdev:3ヶ月/ffprod:永続     
readCount:ffprod:YYYY-MM-DD     KV日次件数（Cloudflare Workers読み込み）   3日     
supabase_flag:ffprod:YYYY-MM-DD Supabase月次フラグ                        3ヶ月  
kv_flag:ffprod:YYYY-MM-DD       KV日次フラグ                              3日  

※1：ffprod/ffdevは自動判定されます
※2：TTL（Time To Live）とは、自動削除までの保存時間を意味し、秒単位で指定されます
```
- KVキーは *`inuichiba-ffworkers/usage-dashboard.html`* から参照することができます

### 📈 KV日次件数（Cloudflare Workers読み込み）

- 閾値: 80,000 件 / 日（Cloudflare無課金枠は 100,000件 / 日）
- 超過時の動作:
  - kv_flag:... に threshold を保存（TTL付き）
  - ユーザーのメニュータップなどの動作は止められないため、**閾値を超えても件数は増え続けます**
  - ユーザーには次の応答メッセージのみ返します：
```markdown
*⚠️ ただいま処理が混み合っているため、一時的にご利用を制限しています。*
*午前9時以降にもう一度お試しください。*
```
- **リセット時刻:毎日 午前9時**（JST）（公式にはないが、多分UTC 0:00 に自動リセット）
- **上限超過時の挙動:** エラーにはならず、**超過分は課金対象になる可能性**があります

### 📝 Supabase月次件数（Supabaseアクセス）

- 閾値: 100,000 件 / 月（無課金枠）
- カウント対象: KVキー writeCount:... による記録
- 超過時の動作:
  - supabase_flag:... に threshold を保存（TTL付き）
  - Supabase、KVキーへの読み取り/書き込みを**完全にスキップ**

### 🔍 閾値チェックのタイミング

- kv_flag の確認は **イベント処理前**（メニュータップ時など）:*lib/events.js*
- supabase_flag の確認は **Supabaseへのチェック（書き込み/読み込み）直前**：*lib/sbWriter.js*
- KVキーの作成など：*lib/kvUtils.js*

### 💬 通知・フラグ仕様

- 閾値を超えた場合：KV日時件数は80,000件/日、Supabase月次件数は90,000件/月になったら**Discord通知**されます
- 各フラグには threshold という値が保存され、**Supabase は3ヶ月後、Cloudflare読み込みは 3日後**に自動削除されます
- 再び利用可能になるのは、**Clopudflare読み込み: 翌朝9時 / Supabase: 月が変わってから**です。

