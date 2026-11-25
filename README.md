# AIトレーサー なぞり君

A local drawing simulator that traces an underdrawing, replays the pen and brush, and exports individually editable colors. / 下絵をトレスするペンと塗り筆の動きをその場で見せ、仕上がりを色別のレイヤーで保存するローカルアプリです。

AI assisted with writing the software. The main tracing and original-color recovery run as image-processing algorithms in the browser. / コーディングにはAIを使いました。トレスと元色の復元を行うのは、ブラウザー内で動く画像処理アルゴリズムです。

## Run / 起動

Use the public app or build the static files and serve the `dist` folder locally. The browser processing uses no account or API key. / 公開アプリを開くか、このフォルダーでビルドして `dist` をローカルに表示します。ブラウザー内の処理にアカウントやAPIキーは不要です。

[Open the app / アプリを開く](https://furuyan1234.github.io/ai-tracer-nazori-kun/)

```powershell
npm run build
python -m http.server 8756 --bind 127.0.0.1 --directory dist
```

[http://127.0.0.1:8756/](http://127.0.0.1:8756/)

Four sample originals are included in `examples/`: a monochrome and color courier, a detailed clock restorer in fine line, and a detailed kite maker in color. / `examples/` にモノクロとカラーの配達員、細線で描いた詳細な時計職人、詳細カラーの凧職人の原稿を収録しています。

1. Open a sample underdrawing or add a PNG, JPEG, or WebP file. / 作例の下絵を選ぶか、PNG・JPEG・WebPを追加します。
2. Click **トレスする**. A pen progressively draws over the faded source. A color original then recovers its colors with a moving brush. For a monochrome original, **モノクロ原稿をAIで仮配色** optionally enables an initial palette. / **トレスする**を押すと、薄くなった原稿の上でペンが線を残します。カラー原稿は続いて筆が動き、原稿の色で塗ります。モノクロ原稿に色を入れる場合は**モノクロ原稿をAIで仮配色**を選びます。
3. Use the seek bar, pause, or rewind. Drawing speed applies to the preview and video capture. Playback speed adjusts only how fast the preview runs. Choose G pen, fine pen, brush pen, or the reconstructed outline. G pen strength ranges from 0 to 100. / シーク、一時停止、巻き戻しを使えます。描画速度はプレビューと動画保存に、再生速度はプレビューの見え方だけに反映します。Gペン・丸ペン・筆ペン・輪郭そのままを選べます。Gペンの強さは0〜100です。
4. Select a layer by its name or pick its color from the drawing. Use a quick swatch or the color picker, hide the layer, or undo/redo. One color group can be shared between panels. / レイヤー名を選ぶか、**色を選ぶ**で絵の中の色を拾います。色見本やカラーピッカーで変更し、表示・非表示や取り消し・やり直しができます。同じ色グループを複数コマで共有できます。
5. **作業一覧** shows thumbnail cards. Opening a card changes the active image, whose name appears under **画像を書き出す**. / **作業一覧**はサムネイル表示です。画像を選ぶと**画像を書き出す**の欄に対象の名前が表示されます。
6. **同じ設定で原稿を差し替え** opens a different original with the same pen, strength, threshold, and speed. / **同じ設定で原稿を差し替え**から別の画像を開くと、ペン、強さ、読み取りのしきい値、速度を引き継げます。

## Exports / 書き出し

- PNG with the source, pen, or palette A/B. / 元絵・ペン・配色A/BをPNGで保存します。
- PSD with a transparent pen layer, one layer per assigned color, and paper. A layer hidden in the app stays present and hidden in the PSD. / 透過のペン層、割り当てた色ごとの層、用紙を一つのPSDに格納します。非表示の色もPSDに非表示のまま残ります。
- SVG with editable pen and color shapes, and JSON coordinates in source pixels, with the top-left as origin. / ペンと色面を別のパスに持つSVG、ペンの輪郭を持つ座標JSONで保存します。座標は左上原点、単位は原稿のピクセルです。
- WebM timeline capture where browser encoders support it. / 対応ブラウザーでは工程をWebMで保存します。
- Editable project JSON with images, edits, color variants, boundary cuts, pen and speed settings, and the selected image. / プロジェクトJSONには原稿・編集結果・配色・塗り分け境界・ペンと速度の設定・選択中の画像が入ります。

## Design and provenance / 設計と来歴

The application extracts closed outlines around ink, preserves enclosed holes, reconstructs ink from crossings of those outlines, and applies pen weight to the reconstructed ink. The perimeter traversal determines when ink appears. A separate connected-region pass assigns colors, and a clipped back-and-forth brush pass makes the paint visible during replay. / インクの外周と中の穴を閉経路として抽出し、経路との交点から線を再構成してペンタッチを加えます。輪郭を通過した時刻に合わせて線が現れます。彩色は別に領域を抽出し、領域内を往復する筆の動きに合わせて色を出します。

The public X demo and the independent line-trace-strokes repository were concept references. The X demo's internal implementation is unknown. This implementation, UI, replays, and example assets were made for this project. The sample illustrations were created with the built-in ImageGen tool. / Xの公開デモと、別の公開リポジトリであるline-trace-strokesを着想の参考にしました。Xのデモの内部方式は未確認です。実装・画面・再生・作例素材は本プロジェクト用に制作しました。作例の生成には内蔵のImageGenを使用しました。

[X demo / Xの公開デモ](https://x.com/masamune_sakaki/status/2125131744991199307) · [line-trace-strokes](https://github.com/nekomimianko/line-trace-strokes) · [Adobe PSD specification / Adobe PSD仕様](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

[Technical report (EN)](docs/technical-paper-en.md) / [技術報告（日本語）](docs/technical-paper-ja.md)

The system is intended for illustrations with identifiable ink and flat colors. It does not infer the artist's actual pen order. Optional auto color uses local nearest-neighbor classification of region geometry and offers provisional colors that can be edited. Closely related hues can share a representative swatch. / 線とベタ色のあるイラスト向けです。元の筆順は分からないため、再生順は輪郭から組み立てます。仮配色は領域の形状をもとにしたローカルの近傍分類で、後から直せます。似た色は一つの代表色にまとめる場合があります。

## MCP

Local stdio, Node.js 22.15 or later. Pass a dedicated directory that contains only allowed input and output files. / ローカルの標準入出力で接続します。Node.js 22.15以降で、読み書きを許可する専用フォルダーを指定します。

```text
node mcp.cjs --workspace <absolute-workspace-path>
```

Call `nazori_trace_png` with a relative `input` path to a non-interlaced 8-bit PNG under the workspace. The server writes PNG, PSD, SVG, and coordinate JSON to a newly created subfolder, and returns their relative paths. The MCP handles original-color and monochrome tracing. Playback and optional mono auto color are available in the browser UI. / `nazori_trace_png` の `input` に専用フォルダー内の相対パスで非インターレースの8-bit PNGを渡します。新規サブフォルダーにPNG・PSD・SVG・座標JSONを書き、相対パスを返します。MCPはカラー原稿の色復元とモノクロトレスに対応します。工程再生とモノクロの仮配色はブラウザー版で利用できます。

Independent engine tests / エンジンの単体検証

```text
node --test engine.test.cjs
```
