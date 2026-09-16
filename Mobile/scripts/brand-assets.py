from pathlib import Path
from PIL import Image, ImageDraw

root = Path(r'c:\Users\chcped\Desktop\luxlab')
assets = Path(r'C:\Users\chcped\.grok\sessions\c%3A%5CUsers%5Cchcped%5CDesktop%5Cluxlab\01a0a7de-892c-7121-a62e-ace306313dda\assets')
logo_src = next(assets.glob('*2441fd8a*.png'))
icon_src = next(assets.glob('*e9309e99*.jpg'))

logo = Image.open(logo_src).convert('RGBA')
icon = Image.open(icon_src).convert('RGBA')
bg = (5, 7, 15, 255)
square = Image.new('RGBA', icon.size, bg)
square.alpha_composite(icon)

front = root / 'Frontend'
logo.save(front / 'logo.png', 'PNG', optimize=True)
square.save(front / 'icone.png', 'PNG', optimize=True)
logo.save(front / 'src' / 'logo.png', 'PNG', optimize=True)
square.resize((192, 192), Image.Resampling.LANCZOS).save(front / 'src' / 'favicon.png', 'PNG', optimize=True)

mobile_assets = root / 'Mobile' / 'assets'
mobile_assets.mkdir(exist_ok=True)
logo.save(mobile_assets / 'logo.png', 'PNG', optimize=True)
square.save(mobile_assets / 'icon.png', 'PNG', optimize=True)

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
    dest.mkdir(exist_ok=True)
    img = square.resize((size, size), Image.Resampling.LANCZOS)
    img.save(dest / 'ic_launcher.png', 'PNG', optimize=True)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    round_img = img.copy()
    round_img.putalpha(mask)
    round_img.save(dest / 'ic_launcher_round.png', 'PNG', optimize=True)

drawable = res / 'drawable'
drawable.mkdir(exist_ok=True)
square.resize((512, 512), Image.Resampling.LANCZOS).save(drawable / 'splash_icon.png', 'PNG', optimize=True)
logo.resize((640, 640), Image.Resampling.LANCZOS).save(drawable / 'splash_logo.png', 'PNG', optimize=True)
print('ok', logo.size, square.size)
