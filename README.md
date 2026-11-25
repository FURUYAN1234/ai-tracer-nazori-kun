# AIトレーサー なぞり君

A local drawing simulator that traces an underdrawing, replays the pen and brush, and exports individually editable colors. / 下絵をトレスするペンと塗り筆の動きをその場で見せ、仕上がりを色別のレイヤーで保存するローカルアプリです。

AI assisted with writing the software. The main tracing and original-color recovery run as image-processing algorithms in the browser. / コーディングにはAIを使いました。トレスと元色の復元を行うのは、ブラウザー内で動く画像処理アルゴリズムです。

## Run / 起動

Use the public app or build the static files and serve the `dist` folder locally. The browser processing uses no account or API key. / 公開アプリを開くか、このフォルダーでビルドして `dist` をローカルに表示します。ブラウザー内の処理にアカウントやAPIキーは不要です。

[Open the app / アプリを開く](https://furuyan1234.github.io/ai-tracer-nazori-kun/)

[Demo and guide / 実演・解説](https://note.com/happy_duck780/n/n75301de9493a) · [AI Manga Creative Suite / AIまんが制作エコシステム](https://note.com/happy_duck780/n/nbdf826604ce7)

```powershell
npm run build
python -m http.server 8756 --bind 127.0.0.1 --directory dist
```

[http://127.0.0.1:8756/](http://127.0.0.1:8756/)

Four sample originals are included in `examples/`. The app opens with the full-color kite maker. The fine-line clock restorer is next in **画像一覧**, followed by the two courier samples. / 起動時はカラーの凧職人の原稿が開きます。**画像一覧**の2枚目はモノクロの時計職人の元絵です。配達員の白黒・カラー作例も収録しています。

1. Use **画像を取り込む** in the header to open a PNG, JPEG, or WebP. To switch originals, open **画像一覧** and choose **作業画面で開く** below the image. / ヘッダーの**画像を取り込む**でPNG・JPEG・WebPを開きます。違う原稿を作業するときは、**画像一覧**で対象の**作業画面で開く**を押します。
2. Click **トレスする**. A pen draws over the faded original. For a color original, the brush then applies colors sampled from the image. On completion, the original appears beside the traced result in color or monochrome. / **トレスする**を押すと、薄く表示した原稿の上にペンで線を引きます。カラー原稿ではその後、元絵から拾った色を筆で塗ります。終了すると、元絵とトレス後の絵が並びます。モノクロ原稿は線画、カラー原稿は色が入った結果が表示されます。
3. Use **工程を再生** to watch the process again with seeking, pausing, and rewinding. Drawing speed applies to the preview and video capture. Playback speed adjusts only how fast the preview runs. Choose G pen, fine pen, brush pen, or the reconstructed outline. G pen strength ranges from 0 to 100. / **工程を再生**から、シーク・一時停止・巻き戻しができます。描画速度はプレビューと動画保存に、再生速度はプレビューの見え方だけに反映します。Gペン・丸ペン・筆ペン・輪郭そのままを選べます。Gペンの強さは0〜100です。
4. Expand **色レイヤーを編集** to adjust the colors. Click a layer's A or B swatch and choose **適用** to confirm its new color. The palette shortcuts apply immediately. Changes support undo and redo. / カラー結果の色を変えるときは**色レイヤーを編集**を開きます。色レイヤーのA・Bの色見本から色を選び、**適用**で確定します。「変更先」の下の色見本はその場で反映されます。変更は取り消し・やり直しができます。
5. **画像一覧** shows each original beside its traced result. Click a thumbnail for a larger preview. Use **作業画面** to return from the image list, preview or replay. / **画像一覧**に元絵と作業後のサムネイルが並びます。サムネイルを押すと大きく表示されます。画像一覧・プレビュー・再生からは**作業画面**で戻れます。
6. **原稿の操作 → 同じ設定で原稿を差し替え** opens a different original with the same pen, strength, threshold, and speed. / **原稿の操作 → 同じ設定で原稿を差し替え**から別の画像を開くと、ペン、強さ、読み取りのしきい値、速度を引き継げます。

Monochrome originals produce line art. Each newly traced color original has its own palette, with two independently editable versions of each color. / モノクロ原稿は線画を出力します。新たにトレスするカラー原稿の配色は原稿ごとに保存され、配色AとBの色を個別に変更できます。

## Exports / 書き出し

Select a thumbnail in **画像一覧**, or click **保存…** above an image on the work screen. The preview shows the selected image at a larger size. Choose a file format and click **保存**. / **画像一覧**のサムネイル、または作業画面で絵の上にある**保存…**を押します。**画像プレビュー**で選んだ絵を確認し、**保存形式**を指定して**保存**を押します。

Originals can be saved as PNG. Finished results support PNG, layered PSD, vector SVG, and coordinate JSON. To save only the ink of a color result as PNG or SVG, open **元絵と線画**. Choose **配色 A** or **配色 B** for a PSD with the color layers. / 元絵はPNG、作業後の絵はPNG・レイヤー付きPSD・ベクターSVG・座標JSONで保存できます。カラー原稿の線画だけをPNG・SVGにする場合は**元絵と線画**を開き、色レイヤー付きPSDは**配色 A**または**配色 B**の絵から保存します。

- PNG with the source, pen, or palette A/B. / 元絵・ペン・配色A/BをPNGで保存します。
- **PSD** saves transparent ink, one layer per assigned color, and paper. Choose PSD to edit ink or colors layer by layer in a PSD-compatible drawing app. Hidden layers stay hidden in the file. / ペン、色ごとのレイヤー、用紙を一つのPSDに保存します。作画ソフトで線や色をレイヤーごとに直したいときに使います。非表示の色レイヤーも非表示のまま保存します。
- **SVG** saves ink outlines and color shapes as vector paths. Choose SVG to enlarge the artwork without pixelation or edit the paths in a vector editor. / ペンの輪郭と色面をベクターパスとして保存します。ぼやけずに拡大したいときや、ベクター編集ソフトで輪郭や色面の形を直したいときに使います。
- **座標JSON** exports ink outlines, the order of the replay contours, and color assignment data in the `nazori-coordinates/1` format. Coordinates use pixels with the top-left corner as the origin. Use this file as input to a custom replay tool or conversion script. / ペンの輪郭、再生する輪郭の順番、色の割り当て情報が入ります。`nazori-coordinates/1` は左上を原点とするピクセル座標の形式です。自作の再生ツールや変換スクリプトに描画データを渡すときに使います。
- WebM timeline capture where browser encoders support it. / 対応ブラウザーでは工程をWebMで保存します。

**プロジェクトを保存** saves the source images, palettes, region boundaries, pen and speed settings, and selected image as a project JSON. Use **プロジェクトを開く** with that file to resume editing. / **プロジェクトを保存**で原稿・配色・塗り分け境界・ペンと速度の設定・選択中の画像をプロジェクトJSONに保存します。作業を再開するときは、**プロジェクトを開く**でそのファイルを選びます。

## Design and provenance / 設計と来歴

The application extracts closed outlines around ink, preserves enclosed holes, reconstructs ink from crossings of those outlines, and applies pen weight to the reconstructed ink. The perimeter traversal determines when ink appears. A separate connected-region pass assigns colors, and a clipped back-and-forth brush pass makes the paint visible during replay. / インクの外周と中の穴を閉経路として抽出し、経路との交点から線を再構成してペンタッチを加えます。輪郭を通過した時刻に合わせて線が現れます。彩色は別に領域を抽出し、領域内を往復する筆の動きに合わせて色を出します。

The public X demo and the independent line-trace-strokes repository were concept references. The X demo's internal implementation is unknown. This implementation, UI, replays, and example assets were made for this project. The sample illustrations were created with the built-in ImageGen tool. / Xの公開デモと、別の公開リポジトリであるline-trace-strokesを着想の参考にしました。Xのデモの内部方式は未確認です。実装・画面・再生・作例素材は本プロジェクト用に制作しました。作例の生成には内蔵のImageGenを使用しました。

[X demo / Xの公開デモ](https://x.com/masamune_sakaki/status/2125131744991199307) · [line-trace-strokes](https://github.com/nekomimianko/line-trace-strokes) · [Adobe PSD specification / Adobe PSD仕様](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

[Technical report (EN)](docs/technical-paper-en.md) / [技術報告（日本語）](docs/technical-paper-ja.md)

The system is intended for illustrations with identifiable ink and flat colors. It builds the replay order from the visible contours. Closely related hues can share a representative swatch. / 線とベタ色のあるイラスト向けです。再生順は画像から読み取った輪郭をもとに組み立てます。似た色は一つの代表色にまとめる場合があります。

## MCP

Local stdio, Node.js 22.15 or later. Pass a dedicated directory that contains only allowed input and output files. / ローカルの標準入出力で接続します。Node.js 22.15以降で、読み書きを許可する専用フォルダーを指定します。

```text
node mcp.cjs --workspace <absolute-workspace-path>
```

Call `nazori_trace_png` with a relative `input` path to a non-interlaced 8-bit PNG under the workspace. The server writes PNG, PSD, SVG, and coordinate JSON to a newly created subfolder, and returns their relative paths. The MCP handles original-color and monochrome tracing. Replay and color-layer editing are available in the browser UI. / `nazori_trace_png` の `input` に専用フォルダー内の相対パスで非インターレースの8-bit PNGを渡します。新規サブフォルダーにPNG・PSD・SVG・座標JSONを書き、相対パスを返します。MCPはカラー原稿の色復元とモノクロトレスに対応します。工程再生と色レイヤーの編集はブラウザー版で利用できます。

Independent engine tests / エンジンの単体検証

```text
node --test engine.test.cjs
```
