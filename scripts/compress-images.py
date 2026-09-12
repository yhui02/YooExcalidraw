#!/usr/bin/env python3
"""批量重压缩画布图片：缩到 --max-dim 以内，编成 webp（无损保留必要的 alpha）。

由 clean-excalidraw-files.mjs 调用：--indir 里是待处理的图片（文件名即序号），
--outdir 里产出同名 .webp，stdout 打印 {序号: {bytes, mimeType}} 供调用方比较取舍。
单张失败只是不压缩它，不影响其余。
"""
import argparse
import io
import json
import os

from PIL import Image, ImageOps


def encode(path, max_dim, quality):
    with Image.open(path) as im:
        # 先把 EXIF 方向烘焙进像素：webp 不带 orientation 标记，不烘焙会让手机照片重编码后转向
        im = ImageOps.exif_transpose(im)
        w, h = im.size
        scale = min(1.0, max_dim / max(w, h))
        if scale < 1.0:
            im = im.resize(
                (max(1, round(w * scale)), max(1, round(h * scale))),
                Image.Resampling.LANCZOS,
            )

        has_alpha_channel = (
            'A' in im.mode or (im.mode == 'P' and 'transparency' in im.info)
        )
        # 只有真的存在半透明像素才保留 alpha，全不透明的图转成 RGB 能再小一截
        if has_alpha_channel and im.convert('RGBA').getchannel('A').getextrema()[0] < 255:
            out = im.convert('RGBA')
        else:
            out = im.convert('RGB')

        buf = io.BytesIO()
        out.save(buf, 'WEBP', quality=quality, method=6)
        return buf.getvalue(), out.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('indir')
    ap.add_argument('outdir')
    ap.add_argument('--max-dim', type=int, default=1440)
    ap.add_argument('--quality', type=int, default=80)
    args = ap.parse_args()

    results = {}
    for name in sorted(os.listdir(args.indir)):
        stem = os.path.splitext(name)[0]
        try:
            data, _ = encode(os.path.join(args.indir, name), args.max_dim, args.quality)
        except Exception as exc:  # 解不开/编不出就跳过这张
            results[stem] = {'error': str(exc)}
            continue
        with open(os.path.join(args.outdir, stem + '.webp'), 'wb') as fh:
            fh.write(data)
        results[stem] = {'bytes': len(data), 'mimeType': 'image/webp'}

    json.dump(results, __import__('sys').stdout)


if __name__ == '__main__':
    main()
