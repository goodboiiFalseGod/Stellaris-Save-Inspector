(function (scope) {
  'use strict';
  const cache = new Map();

  function decodeDds(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 128 || view.getUint32(0, true) !== 0x20534444) throw new Error('Invalid DDS header');
    const width = view.getUint32(16, true), height = view.getUint32(12, true);
    const flags = view.getUint32(80, true), bits = view.getUint32(88, true);
    if (!width || !height || width * height > 16777216) throw new Error('Invalid DDS dimensions');
    if ((flags & 4) && view.getUint32(84, true) === 0x35545844) return decodeDxt5(view, width, height);
    if (!(flags & 64) || ![24, 32].includes(bits)) throw new Error('Unsupported DDS pixel format');
    const bytesPerPixel = bits / 8, rowBytes = width * bytesPerPixel;
    const pitch = view.getUint32(20, true);
    // Некоторые игровые DDS записывают размер всей поверхности в поле pitch.
    const stride = pitch >= rowBytes && pitch <= rowBytes + 3 ? pitch : rowBytes;
    if (buffer.byteLength < 128 + stride * height) throw new Error('Truncated DDS pixels');
    const masks = [92, 96, 100, 104].map(offset => view.getUint32(offset, true));
    function channel(pixel, mask, fallback) {
      if (!mask) return fallback;
      let shift = 0, shifted = mask;
      while ((shifted & 1) === 0) { shift++; shifted >>>= 1; }
      return ((pixel & mask) >>> shift) * 255 / shifted;
    }
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const source = 128 + y * stride + x * bytesPerPixel;
        const pixel = bytesPerPixel === 4 ? view.getUint32(source, true) : view.getUint8(source) | view.getUint8(source + 1) << 8 | view.getUint8(source + 2) << 16;
        const target = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) data[target + c] = channel(pixel, masks[c], c === 3 ? 255 : 0);
      }
    }
    return { width, height, data };
  }

  function decodeDxt5(view, width, height) {
    const columns = Math.ceil(width / 4), rows = Math.ceil(height / 4);
    if (view.byteLength < 128 + columns * rows * 16) throw new Error('Truncated DXT5 pixels');
    const data = new Uint8ClampedArray(width * height * 4);
    const rgb565 = value => [Math.round((value >> 11) * 255 / 31), Math.round(((value >> 5) & 63) * 255 / 63), Math.round((value & 31) * 255 / 31)];
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < columns; bx++) {
        const offset = 128 + (by * columns + bx) * 16;
        const alpha = [view.getUint8(offset), view.getUint8(offset + 1)];
        if (alpha[0] > alpha[1]) {
          for (let i = 1; i <= 6; i++) alpha.push(Math.floor(((7 - i) * alpha[0] + i * alpha[1]) / 7));
        } else {
          for (let i = 1; i <= 4; i++) alpha.push(Math.floor(((5 - i) * alpha[0] + i * alpha[1]) / 5));
          alpha.push(0, 255);
        }
        // 48 бит индексов альфа-канала точно помещаются в Number.
        let alphaIndices = 0;
        for (let i = 0; i < 6; i++) alphaIndices += view.getUint8(offset + 2 + i) * 2 ** (8 * i);
        const colors = [rgb565(view.getUint16(offset + 8, true)), rgb565(view.getUint16(offset + 10, true))];
        colors.push(colors[0].map((value, i) => Math.floor((2 * value + colors[1][i]) / 3)));
        colors.push(colors[0].map((value, i) => Math.floor((value + 2 * colors[1][i]) / 3)));
        const colorIndices = view.getUint32(offset + 12, true);
        for (let pixel = 0; pixel < 16; pixel++) {
          const x = bx * 4 + pixel % 4, y = by * 4 + Math.floor(pixel / 4);
          if (x >= width || y >= height) continue;
          const target = (y * width + x) * 4, color = colors[(colorIndices >>> (pixel * 2)) & 3];
          data.set(color, target);
          data[target + 3] = alpha[Math.floor(alphaIndices / 2 ** (pixel * 3)) % 8];
        }
      }
    }
    return {width, height, data};
  }

  function load(path) {
    if (!cache.has(path)) {
      cache.set(path, fetch(path).then(response => {
        if (!response.ok) throw new Error(`Texture ${response.status}: ${path}`);
        return response.arrayBuffer();
      }).then(decodeDds));
    }
    return cache.get(path);
  }

  function canvas(image) {
    const result = document.createElement('canvas');
    result.width = image.width;
    result.height = image.height;
    result.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return result;
  }

  function parsePalette(text) {
    const palette = { null: [0, 0, 0] };
    const map = { null: [0, 0, 0] };
    for (const match of text.matchAll(/(\w+)\s*=\s*\{\s*flag\s*=\s*rgb\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}\s*map\s*=\s*rgb\s*\{\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
      palette[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])];
      map[match[1]] = [Number(match[5]), Number(match[6]), Number(match[7])];
    }
    palette.map = map;
    return palette;
  }

  function sample(image, u, v) {
    const x = Math.max(0, Math.min(image.width - 1, u * image.width - .5));
    const y = Math.max(0, Math.min(image.height - 1, v * image.height - .5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const x1 = Math.min(x0 + 1, image.width - 1), y1 = Math.min(y0 + 1, image.height - 1);
    return [0, 1, 2, 3].map(c => {
      const top = image.data[(y0 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y0 * image.width + x1) * 4 + c] * fx;
      const bottom = image.data[(y1 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y1 * image.width + x1) * 4 + c] * fx;
      return top * (1 - fy) + bottom * fy;
    });
  }

  function composeFlag(frame, mask, background, symbol, colors) {
    const { width, height } = frame;
    const data = new Uint8ClampedArray(width * height * 4);
    // Координаты GFX_empire_flag_64 и смешивание из flag_sprite.shader.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bg = sample(background, (x + .5 - 5) / 60, (y + .5 - 5) / 60);
        let rgb = [0, 1, 2].map(c => Math.min(255, colors.reduce((sum, color, slot) => sum + color[c] * bg[slot] / 255, 0)));
        const u = (x + .5 - 12) / 46, v = (y + .5 - 12) / 46;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          const emblem = sample(symbol, u, v), alpha = emblem[3] / 255;
          rgb = rgb.map((value, c) => value * (1 - alpha) + emblem[c] * alpha);
        }
        const offset = (y * width + x) * 4;
        const alpha = mask.data[offset + 3] / 255, frameAlpha = frame.data[offset + 3] / 255;
        const outAlpha = Math.max(alpha, frameAlpha);
        for (let c = 0; c < 3; c++) data[offset + c] = outAlpha ? (rgb[c] * alpha * (1 - frameAlpha) + frame.data[offset + c] * frameAlpha) / outAlpha : 0;
        data[offset + 3] = outAlpha * 255;
      }
    }
    return { width, height, data };
  }

  function frame(image, index, count) {
    if (!Number.isInteger(count) || count < 1 || image.width % count || !Number.isInteger(index) || index < 1 || index > count) throw new Error('Invalid sprite frame');
    const width = image.width / count, data = new Uint8ClampedArray(width * image.height * 4);
    for (let y = 0; y < image.height; y++) {
      const start = (y * image.width + (index - 1) * width) * 4;
      data.set(image.data.subarray(start, start + width * 4), y * width * 4);
    }
    return { width, height: image.height, data };
  }

  scope.GameArt = { decodeDds, load, canvas, parsePalette, composeFlag, frame };
  if (typeof module !== 'undefined') module.exports = scope.GameArt;
})(globalThis);
