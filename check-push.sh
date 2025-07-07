#!/bin/sh
# check-push.sh - リポジトリへのpush権限をチェックする簡易スクリプト
# Usage: ./check-push.sh

echo "🔍 現在のGitリポジトリ:"
repo=$(git remote get-url origin 2>/dev/null)

if [ -z "$repo" ]; then
  echo "❌ Gitリポジトリではないか、remoteが設定されていません。"
  exit 1
fi

echo "✅ Remote: $repo"
echo "🛠️ Push権限チェック中..."

# テストブランチを使ってpushできるか確認
branch="__push_test_$(date +%s)"
git checkout -b "$branch" >/dev/null 2>&1
touch .push_check_$$
git add .push_check_$$
git commit -m "Push test from check-push.sh" >/dev/null 2>&1

if git push origin "$branch" >/dev/null 2>&1; then
  echo "✅ Push権限があります！"
  git push origin --delete "$branch" >/dev/null 2>&1
else
  echo "❌ Push権限がありません。GitHub上でWrite権限が与えられているか確認してください。"
fi

# 後片付け
git reset HEAD~ >/dev/null 2>&1
rm .push_check_* 2>/dev/null
git checkout - >/dev/null 2>&1
git branch -D "$branch" >/dev/null 2>&1
