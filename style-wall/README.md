# 風格參考牆

Simon 的個人參考牆。圖片為主，點開才看筆記。管理頁可上傳圖片或影片，由 Gemini 當場分析，再寫回這個倉庫。

網站是純靜態檔案，給 GitHub Pages 用。沒有自己的伺服器，也沒有排程。

- 參考牆：`index.html`
- 管理頁：`admin.html`
- 資料：`data/items.json`
- 媒體：`media/`

金鑰只放在每台裝置瀏覽器的 localStorage，不會進這個倉庫。

## 第一次設定

1. 在倉庫 Settings → Pages，Source 選 Deploy from a branch，分支 `main`，資料夾 `/ (root)`。
2. 打開管理頁，依頁面上的步驟建立 GitHub 細粒度 token（只勾這個倉庫，Contents 讀寫）與 Gemini API 金鑰，各貼一次。
3. 預設模型是 `gemini-4-hydrogen`。`gemini-2.5-flash` 將在 2026-12-01 被轉走。

公開網址形如 `https://a2003azxsdc-dotcom.github.io/style-wall/` ，管理頁在後面加 `admin.html`。

## 限制

- 參考牆是公開的。
- 圖片會縮到長邊約 1600 像素。
- 影片上限 50MB。超過約 20MB 時，GitHub Contents API 有時會失敗。超過約 12MB 會改走 Gemini Files API，瀏覽器有時會擋住，那時請先把影片壓小。
- 參考牆讀 `items.json` 時先問 GitHub API，所以不用等 Pages 重新部署。剛在這台裝置存的檔，也會先從瀏覽器裡顯示。

## 檢查

```bash
node --test tests/logic.test.mjs
```
