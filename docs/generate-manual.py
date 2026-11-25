"""Build the illustrated Nazori-kun manual with ReportLab.

Run from any directory with: python docs/generate-manual.py
NAZORI_PDF_FONT may point to a Japanese TrueType font or collection.
"""
import json
import os
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
OUTPUT = ROOT / "downloads" / "nazori-kun-manual.pdf"
APP = "https://furuyan1234.github.io/ai-tracer-nazori-kun/"
GIT = "https://github.com/FURUYAN1234/ai-tracer-nazori-kun"
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
INK = HexColor("#33213c")
MUTED = HexColor("#635266")
ACCENT = HexColor("#803b71")
PAPER = HexColor("#fcf5f7")
LINE = HexColor("#e6d5df")
WIDTH, HEIGHT = A4
LEFT = 42
BODY_WIDTH = WIDTH - LEFT * 2


class Manual:
    def __init__(self):
        default = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "meiryo.ttc"
        if not default.exists():
            default = Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf")
        regular = Path(os.environ.get("NAZORI_PDF_FONT", default))
        bold = regular.with_name("meiryob.ttc")
        pdfmetrics.registerFont(TTFont("Nazori", str(regular), subfontIndex=0))
        pdfmetrics.registerFont(TTFont("NazoriBold", str(bold if bold.exists() else regular), subfontIndex=0))
        OUTPUT.parent.mkdir(exist_ok=True)
        self.pdf = canvas.Canvas(str(OUTPUT), pagesize=A4, invariant=True)
        self.pdf.setTitle("AIトレーサー なぞり君 v" + VERSION + " 操作マニュアル")
        self.pdf.setAuthor("FURU")
        self.page = 0
        self.y = 0

    def paragraph(self, text, *, size=11, leading=17, color=INK, bold=False, left=LEFT, width=BODY_WIDTH):
        style = ParagraphStyle(
            "manual", fontName="NazoriBold" if bold else "Nazori", fontSize=size,
            leading=leading, alignment=TA_LEFT, wordWrap="CJK", textColor=color,
        )
        block = Paragraph(escape(text), style)
        _, height = block.wrap(width, HEIGHT)
        if self.y - height < 46:
            raise ValueError(f"Page {self.page} overflows at {text}")
        block.drawOn(self.pdf, left, self.y - height)
        self.y -= height + 6

    def section(self, title, text):
        self.y -= 4
        self.paragraph(title, size=14, leading=20, bold=True, color=ACCENT)
        self.paragraph(text)

    def screenshot(self, name, caption, *, limit=295):
        image = ImageReader(str(ASSETS / name))
        w, h = image.getSize()
        scale = min(BODY_WIDTH / w, limit / h)
        width, height = w * scale, h * scale
        x = (WIDTH - width) / 2
        self.y -= height + 7
        if self.y < 46:
            raise ValueError(f"Page {self.page} overflows at {name}")
        self.pdf.drawImage(image, x, self.y, width, height)
        self.y -= 6
        self.paragraph(caption, color=MUTED, size=9, leading=13)

    def link(self, title, url):
        y = self.y
        self.paragraph(title, color=ACCENT, bold=True)
        self.pdf.linkURL(url, (LEFT, self.y + 4, LEFT + BODY_WIDTH, y), relative=0)

    def start(self, title, label):
        if self.page:
            self.pdf.showPage()
        self.page += 1
        c = self.pdf
        c.setFillColor(PAPER)
        c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
        c.setStrokeColor(LINE)
        c.line(LEFT, 48, WIDTH - LEFT, 48)
        c.setFont("Nazori", 9)
        c.setFillColor(MUTED)
        c.drawString(LEFT, 30, "AIトレーサー なぞり君  v" + VERSION)
        c.drawRightString(WIDTH - LEFT, 30, str(self.page))
        self.y = HEIGHT - 45
        self.paragraph(label, color=ACCENT, size=11, leading=15, bold=True)
        self.paragraph(title, size=23, leading=30, bold=True)
        self.y -= 8

    def finish(self):
        self.pdf.save()


def build():
    m = Manual()
    m.start("AIトレーサー なぞり君", "操作マニュアル  v" + VERSION)
    m.paragraph("元絵を読む → ペンで線を描く → カラー原稿の色を塗る → 結果を保存する。ブラウザーでその工程を見られます。原稿の画像処理に生成AI・APIキーは不要です。")
    m.link("公開アプリを開く", APP)
    m.section("最初の一枚", "起動時のカラー作例「凧職人」で「トレスする」を押します。白黒の作例は「画像一覧」で「時計職人」を選び、「作業画面で開く」を押します。手持ちの画像は上部の「画像を取り込む」からPNG・JPEG・WebPを選びます。複数枚も読み込めます。")
    m.screenshot("image-list.jpg", "画像一覧で元絵と作業後を確認。サムネイルを押すと画像プレビューを開きます。")
    m.section("このマニュアルの内容", "2 原稿とペンタッチ／3 描画の再生と色の調整／4 書き出し／5 作業の再開・API設定・MCP")

    m.start("原稿を選んでトレスする", "原稿とペンタッチ")
    m.section("カラー原稿と白黒原稿", "カラー原稿では、ペン入れの後に筆へ切り替わり、元絵から拾った色を塗ります。白黒原稿は線画まで進みます。処理が終わると、元絵と作業後の絵が横に並びます。")
    m.screenshot("workspace-color.jpg", "カラー作例「凧職人」。左は元絵、右は元絵の色を使ったトレス結果。", limit=238)
    m.section("線の設定", "「ペンタッチ」でGペン・丸ペン・筆ペン・輪郭そのままを切り替えます。Gペンを使うときは「Gペンの強さ」で線の入り抜きや太さの差を調整します。白黒で淡い線を拾うには「線の読み取り」の「濃さのしきい値」を調整して、トレスし直します。")

    m.start("ペン先と筆先の動きを見る", "描画と再生")
    m.section("工程をもう一度見る", "「工程を再生」で最初から見られます。「一時停止」と再生位置のスライダーで工程の途中へ移動できます。「描画速度」はトレス時、「再生速度」は再生時の速さです。「動画を保存」は対応ブラウザーで工程をWebMに書き出します。")
    m.screenshot("drawing-replay.jpg", "カラー原稿の工程表示。塗っている場所を筆先が示します。", limit=234)
    m.section("カラー結果の一色だけを変える", "配色欄の色チップを開き、色を選んで「適用」を押します。同じ色レイヤーに入っている箇所が一緒に変わります。「配色 AとBを比べる」で二つの配色を見比べられます。「元に戻す」「やり直す」も使えます。")

    m.start("画像の用途に合わせて保存する", "書き出し")
    m.paragraph("「画像一覧」でサムネイルを選ぶか、絵の上の「保存…」を押します。画像プレビューで形式と保存サイズを選んで「保存」を押します。")
    m.section("元寸とプレビュー寸法", "作業画面・WebMは原稿の比率を保ち、長辺1,600pxまでで再生します。大きな原稿は、保存サイズで「元寸」か「プレビュー寸法」を選べます。元寸では原本を読み直し、線と色を元の画素から処理します。")
    m.section("大きな原稿", "元寸保存は1,600万画素以下が対象です。取り込みは3,200万画素、各辺8,192px、1枚24 MBまで。輪郭や色レイヤーが複雑で元寸処理の上限に達した場合は、プレビュー寸法を選びます。")
    m.section("PNG と PSD", "PNGは完成した画像の表示や共有に使います。元絵の保存もPNGです。PSDはペン・色別・用紙のレイヤーを分けて保ち、Photoshopなどで編集するときに使います。")
    m.section("SVG と座標JSON", "SVGは拡大やベクター編集用です。色面とペンの輪郭をパスとして保存します。座標JSON（nazori-coordinates/1）は描画の輪郭・再生順・色の割り当てを他のプログラムに渡す形式です。左上が原点で、単位はピクセルです。")

    m.start("作業の再開と外部ツール連携", "プロジェクト・API設定・MCP")
    m.section("続きから開く", "「プロジェクトを保存」で、原稿・配色・ペン・速度などをまとめます。元寸保存できる原稿は圧縮原本も入ります。上限は85 MBです。「プロジェクトを開く」で再開できます。「同じ設定で原稿を差し替え」で別原稿にもペン設定を使えます。")
    m.section("APIキー・外部サービス", "トレス・色の復元・画像保存はブラウザー内の画像処理で完結します。利用のためのAPIキー、外部AIサービスのアカウントや契約、モデルのダウンロードはいりません。作例の読み込みとマニュアルの表示には公開サイトのファイルを取得します。")
    m.section("MCPから処理する", "Node.js 22.15以降を用意します。読み書きを許可した専用フォルダーを指定して、ローカル標準入出力でMCPクライアントに登録します。入力は8ビットのノンインターレースPNGです。")
    m.paragraph("node mcp.cjs --workspace <絶対パス>", size=10, leading=15, bold=True)
    m.paragraph("nazori_trace_png の input に専用フォルダー内の相対パスを渡します。PNG・PSD・SVG・座標JSONは新規サブフォルダーへ保存されます。工程再生と色の編集はブラウザーで行います。")
    m.section("線が拾いにくいとき", "輪郭が見える、線とベタ色がはっきりしたイラストが適しています。淡い線やグラデーションが多い原稿では、線が途切れたり、近い色が一つにまとまったりします。最初は付属作例で違いを確認してください。")
    m.link("GitHubで対応形式と技術報告を読む", GIT)
    m.finish()


if __name__ == "__main__":
    build()
