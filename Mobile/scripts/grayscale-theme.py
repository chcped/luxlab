import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

root = Path(r'c:\Users\chcped\Desktop\luxlab')

def gray_hex(match):
    token = match.group(0)
    hexpart = token[1:]
    if len(hexpart) == 3:
        hexpart = ''.join(c * 2 for c in hexpart)
    if len(hexpart) not in (6, 8):
        return token
    r, g, b = int(hexpart[0:2], 16), int(hexpart[2:4], 16), int(hexpart[4:6], 16)
    y = int(round(0.299 * r + 0.587 * g + 0.114 * b))
    out = f'#{y:02x}{y:02x}{y:02x}'
    if len(hexpart) == 8:
        out += hexpart[6:8].lower()
    return out

def gray_rgba(match):
    nums = match.group(1)
    parts = [p.strip() for p in nums.split(',')]
    if len(parts) < 3:
        return match.group(0)
    r, g, b = [float(parts[i]) for i in range(3)]
    y = int(round(0.299 * r + 0.587 * g + 0.114 * b))
    rest = ',' + ','.join(parts[3:]) if len(parts) > 3 else ''
    prefix = 'rgba' if match.group(0).startswith('rgba') else 'rgb'
    return f'{prefix}({y},{y},{y}{rest})'

hex_re = re.compile(r'#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])')
rgba_re = re.compile(r'rgba?\(([^)]+)\)')

css_path = root / 'Frontend' / 'src' / 'styles.css'
css = css_path.read_text(encoding='utf-8')
css = hex_re.sub(gray_hex, css)
css = rgba_re.sub(gray_rgba, css)
overrides = """
.primary{background:#fff;border:1px solid #fff;color:#000;box-shadow:none}
.primary:hover{background:#e6e6e6;color:#000}
.primary:focus-visible{outline-color:#fff}
.member.watching{background:#fff;border:1px solid #fff}
.member.watching .member-name{color:#000}
.member.watching small{color:#333}
.member.watching button{color:#000;background:#00000014}
.tabs button.active{background:#fff;color:#000}
.source.selected{border-color:#fff;background:#2a2a2a}
.qualitySelected,.quality-selected{border-color:#fff}
"""
css_path.write_text(css + overrides, encoding='utf-8')

def grayscale_rgba(path, fill=(0, 0, 0, 255)):
    img = Image.open(path).convert('RGBA')
    gray = ImageOps.grayscale(img)
    out = Image.merge('RGBA', (gray, gray, gray, img.getchannel('A')))
    if fill:
        bg = Image.new('RGBA', out.size, fill)
        bg.alpha_composite(out)
        out = bg
    out.save(path, 'PNG', optimize=True)

for rel in [
    'Frontend/logo.png', 'Frontend/icone.png',
    'Frontend/src/logo.png', 'Frontend/src/favicon.png',
    'Mobile/assets/logo.png', 'Mobile/assets/icon.png',
    'Mobile/android/app/src/main/res/drawable/splash_logo.png',
    'Mobile/android/app/src/main/res/drawable/splash_icon.png',
]:
    grayscale_rgba(root / rel)

icon = Image.open(root / 'Frontend' / 'icone.png').convert('RGBA')
sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}
res = root / 'Mobile' / 'android' / 'app' / 'src' / 'main' / 'res'
for folder, size in sizes.items():
    dest = res / folder
    img = icon.resize((size, size), Image.Resampling.LANCZOS)
    img.save(dest / 'ic_launcher.png', 'PNG', optimize=True)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    round_img = img.copy()
    round_img.putalpha(mask)
    round_img.save(dest / 'ic_launcher_round.png', 'PNG', optimize=True)

print('themed')
