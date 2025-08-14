


// ✅ 日本時間のタイムスタンプ（先頭0なしのH形式）
// 例）2025/05/09 6:16:53
export function getFormattedJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, '0');
  const dd = String(jst.getDate()).padStart(2, '0');
  const h = jst.getHours();
  const mi = String(jst.getMinutes()).padStart(2, '0');
  const ss = String(jst.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${h}:${mi}:${ss}`;
}

