"""Render source view-tree previews. These PNGs are not Android device captures.

Usage: python3 scripts/render-native-compact-menu-previews.py VIEW_TREES.json OUTPUT_DIR
Requires Pillow. Native Android typography/window dispatch still require device QA.
"""
import json
import math
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

data = json.loads(Path(sys.argv[1]).read_text())
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
density = data["density"]
font_dir = Path("/usr/share/fonts/truetype/dejavu")


def font(size, bold=False):
    return ImageFont.truetype(str(font_dir / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")), max(1, round(size)))


def color(value):
    value = value & 0xffffffff
    return ((value >> 16) & 255, (value >> 8) & 255, value & 255, (value >> 24) & 255)


def lines(text, face, width):
    result = []
    for paragraph in text.split("\n"):
        current = ""
        for word in paragraph.split():
            trial = (current + " " + word).strip()
            if current and face.getlength(trial) > width:
                result.append(current)
                current = word
            else:
                current = trial
        result.append(current)
    return result


def layout(node, width, font_scale=1):
    pad = node.get("padding", [0, 0, 0, 0])
    content_width = max(1, width - pad[0] - pad[2])
    item = {"node": node, "width": width, "children": []}
    if "text" in node:
        face = font(node["sizeSp"] * density * font_scale, node.get("bold", False))
        text_lines = lines(node["text"], face, content_width)
        line_height = math.ceil(face.size * 1.25)
        item.update(face=face, text_lines=text_lines, line_height=line_height)
        height = pad[1] + pad[3] + line_height * len(text_lines)
    else:
        children = node.get("children", [])
        horizontal = node.get("orientation", 1) == 0
        if horizontal:
            fixed = sum(max(0, c.get("width", -1)) + c.get("margin", [0, 0, 0, 0])[0]
                        + c.get("margin", [0, 0, 0, 0])[2] for c in children if c.get("weight", 0) == 0)
            weighted_margins = sum(c.get("margin", [0, 0, 0, 0])[0] + c.get("margin", [0, 0, 0, 0])[2]
                                   for c in children if c.get("weight", 0) > 0)
            weight = sum(c.get("weight", 0) for c in children)
            cursor = pad[0]
            row_height = 0
            for child in children:
                margin = child.get("margin", [0, 0, 0, 0])
                cw = ((content_width - fixed - weighted_margins) * child.get("weight", 0) / weight
                      if child.get("weight", 0) > 0 else child.get("width", content_width))
                if cw < 0:
                    cw = content_width
                rendered = layout(child, cw, font_scale)
                rendered.update(x=cursor + margin[0], y=pad[1] + margin[1])
                item["children"].append(rendered)
                cursor += cw + margin[0] + margin[2]
                row_height = max(row_height, rendered["height"] + margin[1] + margin[3])
            height = pad[1] + pad[3] + row_height
            for child in item["children"]:
                child["y"] += max(0, (row_height - child["height"]) / 2)
        else:
            cursor = pad[1]
            for child in children:
                margin = child.get("margin", [0, 0, 0, 0])
                rendered = layout(child, content_width - margin[0] - margin[2], font_scale)
                rendered.update(x=pad[0] + margin[0], y=cursor + margin[1])
                item["children"].append(rendered)
                cursor += rendered["height"] + margin[1] + margin[3]
            height = cursor + pad[3]
    item["height"] = node.get("height", -2) if node.get("height", -2) > 0 else height
    return item


def paint(canvas, item, x, y):
    node = item["node"]
    draw = ImageDraw.Draw(canvas)
    if "color" in node:
        rgba = color(node["color"])
        backing = canvas.getpixel((max(0, int(x)), max(0, int(y))))[:3]
        fill = tuple(round(rgba[i] * rgba[3] / 255 + backing[i] * (1 - rgba[3] / 255)) for i in range(3))
        draw.rounded_rectangle((x, y, x + item["width"], y + item["height"]), radius=node.get("radius", 0), fill=fill)
    if "text" in node:
        if node["text"] == "ⓘ":
            cx, cy = x + item["width"] / 2, y + item["height"] / 2
            r = min(item["width"], item["height"]) * 0.23
            draw.ellipse((cx-r, cy-r, cx+r, cy+r), outline=color(node["textColor"])[:3], width=2)
            face = font(item["face"].size * 0.6, True)
            draw.text((cx, cy), "i", font=face, fill=color(node["textColor"])[:3], anchor="mm")
            return
        pad = node.get("padding", [0, 0, 0, 0])
        ty = y + pad[1]
        if node["type"] == "Button":
            ty = y + (item["height"] - len(item["text_lines"]) * item["line_height"]) / 2
        for line in item["text_lines"]:
            tx = x + pad[0]
            if node["type"] == "Button":
                tx = x + (item["width"] - item["face"].getlength(line)) / 2
            draw.text((tx, ty), line, font=item["face"], fill=color(node["textColor"])[:3], anchor="lt")
            ty += item["line_height"]
    for child in item["children"]:
        paint(canvas, child, x + child["x"], y + child["y"])


def header(canvas, title, subtitle):
    draw = ImageDraw.Draw(canvas)
    draw.text((40, 28), title, font=font(29, True), fill="#edf2f7")
    draw.text((40, 74), subtitle, font=font(16), fill="#a8b4c0")
    draw.text((40, canvas.height - 37), "Prévia do source • fonte substituta • não é captura de aparelho Android", font=font(15), fill="#8998a5")


canvas = Image.new("RGB", (1440, 650), "#10151b")
header(canvas, "NVU • Menu compacto e confirmação de rota", "Views e textos extraídos dos métodos nativos executados no harness Java.")
draw = ImageDraw.Draw(canvas)
frames = [("idle", "Antes de iniciar", "Título no topo, sem a linha do X."),
          ("active", "Viagem em andamento", "Rota e ações preservadas."),
          ("ready", "Ao confirmar a rota", "Somente a mensagem NVU aparece.")]
for index, (key, title, caption) in enumerate(frames):
    x = 40 + index * 470
    draw.text((x, 135), title, font=font(22, True), fill="#e1e8f0")
    draw.text((x, 171), caption, font=font(15), fill="#a8b4c0")
    surface = data[key]["menu"] or data[key]["message"]
    rendered = layout(surface, 384)
    paint(canvas, rendered, x, 222)
    if key == "ready":
        draw.text((x, 335), "Durante: menu e botão ocultos", font=font(16), fill="#9fbdba")
        draw.text((x, 378), "Depois: botão volta; menu recolhido", font=font(15), fill="#c7d0da")
        draw.rounded_rectangle((x, 423, x + 102, 471), radius=12, fill="#30373e", outline="#737e8a")
        draw.text((x + 30, 436), "NVU", font=font(20, True), fill="#f4f7fb")
canvas.save(output / "PREVIAS_MENU_NVU_1.0.466.png")

large = Image.new("RGB", (1100, 830), "#10151b")
header(large, "NVU • Nome extenso e fonte ampliada", "Fonte 2× na prévia. O corpo nativo tem rolagem limitada à área disponível da tela.")
item = layout(data["largeFont"]["menu"], 384, font_scale=2)
paint(large, item, 48, 145)
draw = ImageDraw.Draw(large)
for idx, line in enumerate(["Nome da empresa completo", "Nenhuma linha reservada ao X", "Conteúdo com rolagem quando necessário", "Altura recalculada após rotação"]):
    draw.text((500, 200 + idx * 60), line, font=font(18), fill="#c7d0da")
large.save(output / "PREVIA_MENU_NVU_FONTE_AMPLIADA.png")
print("Previews generated from source view trees; Android device captures remain pending.")
