#!/usr/bin/env python3
"""
Gera os assets de identidade visual do Abastece Já a partir do pôster da marca.

Uso (na raiz do projeto):
    python3 scripts/gerar-assets.py [caminho/do/poster.png]
Padrão do pôster: assets/brand/abastece-ja-poster.png

Saídas:
    icons/icon-192.png, icons/icon-512.png          ícones "any" (escudo em fundo escuro, com respiro)
    icons/icon-maskable-512.png                     ícone maskable (conteúdo dentro da zona segura de 80 %)
    icons/apple-touch-icon-180.png                  ícone do iOS (opaco, sem transparência)
    icons/favicon-32.png                            favicon
    icon-192.png, icon-512.png, icon-maskable-512.png   cópias legadas na raiz (idênticas às de icons/)
    assets/brand/logo-escudo.png                    escudo com fundo transparente (telas de login, claro e escuro)
    assets/splash/splash-<L>x<A>.png                telas de abertura do iOS (apple-touch-startup-image)

Dependências: pillow, numpy, scipy.
"""
import sys, shutil
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

RAIZ = Path(__file__).resolve().parent.parent
POSTER = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "assets/brand/abastece-ja-poster.png"
BG = (1, 3, 8)                      # preto-azulado do pôster (também é o background_color do manifest)

# Região do escudo no pôster 1024x1536 (medida em pixels): topo do aro ~y=462, ponta ~y=1207; a legenda de cima termina ~y=435.
CROP = (123, 440, 893, 1210)        # quadrado de 770 px: termina logo abaixo da ponta do escudo (exclui o filete dourado do pôster, em y~1215)


def feather_paste(canvas, img, box_size):
    """Cola `img` (quadrada) no centro de `canvas` com borda esfumada, para o brilho do pôster se dissolver no fundo sem emenda."""
    img = img.resize((box_size, box_size), Image.LANCZOS).convert("RGB")
    m = Image.new("L", (box_size, box_size), 0)
    margem = int(box_size * 0.10)
    m.paste(255, (margem, margem, box_size - margem, box_size - margem))
    m = m.filter(ImageFilter.GaussianBlur(margem * 0.55))
    x = (canvas.width - box_size) // 2
    y = (canvas.height - box_size) // 2
    canvas.paste(img, (x, y), m)
    return canvas


def icone(tamanho, fracao):
    """Ícone quadrado opaco. `fracao` = altura do escudo / lado do ícone (0.80 = "any", 0.60 = maskable, a zona segura é o círculo central de 80 %).
    O recorte ganha uma moldura extra (repetindo a borda escura do próprio pôster) e só então é esfumado: assim o aro do escudo não escurece."""
    recorte = np.asarray(poster.crop(CROP).convert("RGB")).astype(float)
    pesos = np.linspace(0.2, 1.0, 8)[:, None, None]                                  # últimas linhas: o brilho do filete dourado do pôster vaza até aqui
    recorte[-8:] = recorte[-8:] * (1 - pesos) + np.array(BG) * pesos
    recorte = recorte.round().astype("uint8")
    extra = int(recorte.shape[0] * 0.12)
    recorte = Image.fromarray(np.pad(recorte, ((extra, extra), (extra, extra), (0, 0)), mode="edge"))
    escudo_h = 723 / recorte.width                       # altura do escudo (~723 px no pôster) em relação ao lado do recorte ampliado
    base = Image.new("RGB", (tamanho, tamanho), BG)
    return feather_paste(base, recorte, int(round(tamanho * fracao / escudo_h)))


def escudo_transparente():
    """Escudo com fundo transparente. O aro é prateado/dourado (canal vermelho alto); o brilho azul ao redor quase não tem vermelho.
    Para cada linha pega-se a borda externa do aro (esq./dir.), suaviza-se (mediana) para ignorar os raios das faíscas e preenche-se entre elas."""
    rec = poster.crop(CROP).convert("RGB")
    a = np.asarray(rec).astype(int)
    aro = a[:, :, 0] > 110
    h, w = aro.shape
    esq = np.full(h, np.nan); dir_ = np.full(h, np.nan)
    for y in range(h):
        xs = np.where(aro[y])[0]
        if len(xs) >= 3: esq[y], dir_[y] = xs.min(), xs.max()
    ok = ~np.isnan(esq)
    # bloco contínuo de linhas a partir do meio (aceita falhas de até 8 linhas): ignora o filete dourado que fica abaixo da ponta
    def limite(passo):
        y, ultimo, falhas = h // 2, h // 2, 0
        while 0 <= y < h and falhas <= 8:
            if ok[y]: ultimo, falhas = y, 0
            else: falhas += 1
            y += passo
        return ultimo
    topo, base = limite(-1), limite(+1)
    ys = np.arange(topo, base + 1)
    e = np.interp(ys, np.where(ok)[0], esq[ok]); d = np.interp(ys, np.where(ok)[0], dir_[ok])
    e = ndi.median_filter(e, size=61, mode="nearest"); d = ndi.median_filter(d, size=61, mode="nearest")
    forma = np.zeros((h, w), bool)
    for y, xe, xd in zip(ys, e, d):
        if xd > xe: forma[y, int(round(xe)):int(round(xd)) + 1] = True
    forma = ndi.binary_fill_holes(forma)
    forma = ndi.binary_opening(forma, structure=np.ones((3, 3)), iterations=2)
    alfa = Image.fromarray((forma * 255).astype("uint8"), "L").filter(ImageFilter.GaussianBlur(1.2))
    out = rec.convert("RGBA")
    out.putalpha(alfa)
    return out.crop(out.getbbox())


def splash(largura, altura):
    """Pôster inteiro, ajustado à tela; o que sobra em cima/embaixo (ou nas laterais) repete a borda do próprio pôster."""
    ph, pw = poster.height, poster.width
    esc = min(largura / pw, altura / ph) if altura / largura < ph / pw else largura / pw
    if altura / largura < ph / pw:                    # tela mais "larga" que o pôster (tablet): ajusta pela altura
        esc = altura / ph
    else:                                             # tela mais "alta" (celular): ajusta pela largura
        esc = largura / pw
    nw, nh = round(pw * esc), round(ph * esc)
    arte = np.asarray(poster.resize((nw, nh), Image.LANCZOS).convert("RGB"))
    pad_v, pad_h = max(0, altura - nh), max(0, largura - nw)
    cima, esq = pad_v // 2, pad_h // 2
    arte = np.pad(arte, ((cima, pad_v - cima), (esq, pad_h - esq), (0, 0)), mode="edge")
    return Image.fromarray(arte[:altura, :largura])


if __name__ == "__main__":
    if not POSTER.exists():
        sys.exit(f"Pôster não encontrado: {POSTER}")
    poster = Image.open(POSTER).convert("RGB")
    (RAIZ / "icons").mkdir(exist_ok=True)
    (RAIZ / "assets/brand").mkdir(parents=True, exist_ok=True)
    (RAIZ / "assets/splash").mkdir(parents=True, exist_ok=True)
    mestre = RAIZ / "assets/brand/abastece-ja-poster.png"
    if POSTER.resolve() != mestre.resolve():
        shutil.copyfile(POSTER, mestre)

    icone(512, 0.80).save(RAIZ / "icons/icon-512.png", optimize=True)
    icone(192, 0.80).save(RAIZ / "icons/icon-192.png", optimize=True)
    icone(512, 0.60).save(RAIZ / "icons/icon-maskable-512.png", optimize=True)     # zona segura: círculo central de 80 %
    icone(180, 0.86).save(RAIZ / "icons/apple-touch-icon-180.png", optimize=True)  # iOS aplica a própria máscara
    icone(32, 0.92).save(RAIZ / "icons/favicon-32.png", optimize=True)
    for n in ("icon-192.png", "icon-512.png", "icon-maskable-512.png"):          # cópias legadas da raiz
        shutil.copyfile(RAIZ / "icons" / n, RAIZ / n)

    logo = escudo_transparente()
    logo.thumbnail((440, 440), Image.LANCZOS)                                     # usado em ~100-140 px nas telas de login (até 3x de densidade)
    logo.save(RAIZ / "assets/brand/logo-escudo.png", optimize=True)

    # tamanhos CSS (portrait) × fator de pixel dos iPhones/iPads atuais -> pixels reais
    DISPOSITIVOS = [(430, 932, 3), (393, 852, 3), (428, 926, 3), (390, 844, 3), (375, 812, 3), (414, 896, 3), (414, 896, 2), (414, 736, 3), (375, 667, 2),
                    (834, 1194, 2), (1024, 1366, 2), (820, 1180, 2), (810, 1080, 2)]
    vistos = set()
    for w, h, f in DISPOSITIVOS:
        px = (w * f, h * f)
        if px in vistos: continue
        vistos.add(px)
        # PNG de 256 cores com dithering: a arte é escura e cheia de degradês; cai de ~1,5 MB para ~0,4 MB por tela sem diferença visível numa abertura de 1 s
        splash(*px).quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(RAIZ / f"assets/splash/splash-{px[0]}x{px[1]}.png", optimize=True)
    print("ok:", len(vistos), "telas de abertura; ícones e logo gerados.")
