export type DecodedPhoto = {
  bitmap: ImageBitmap;
  format: string;
  note?: string;
};

const extensionOf = (file: File) => file.name.split(".").pop()?.toLowerCase() ?? "";

async function bitmapFromBlob(blob: Blob) {
  return createImageBitmap(blob, {
    imageOrientation: "from-image",
    colorSpaceConversion: "default",
    premultiplyAlpha: "default",
  });
}

async function decodeHeic(file: File): Promise<DecodedPhoto> {
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.98,
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return {
    bitmap: await bitmapFromBlob(blob),
    format: "HEIC/HEIF",
    note: "HEIC 已在本机解码；导出文件不保留原始 EXIF。",
  };
}

async function decodeRaw(file: File): Promise<DecodedPhoto> {
  const { default: LibRaw } = await import("libraw-wasm");
  const raw = new LibRaw();

  try {
    await raw.open(new Uint8Array(await file.arrayBuffer()), {
      useCameraWb: true,
      useCameraMatrix: 3,
      outputColor: 1,
      outputBps: 8,
      userQual: 3,
      highlight: 3,
      noAutoBright: false,
      userFlip: -1,
    });

    const decoded = await raw.imageData();
    if (!decoded) throw new Error("RAW 文件中没有可读取的图像数据。");
    const rgba = new Uint8ClampedArray(decoded.width * decoded.height * 4);
    const channels = Math.max(decoded.colors, 3);

    for (let source = 0, target = 0; target < rgba.length; source += channels, target += 4) {
      if (decoded.bits === 16) {
        const pixels = decoded.data as Uint16Array;
        rgba[target] = pixels[source] >> 8;
        rgba[target + 1] = pixels[source + 1] >> 8;
        rgba[target + 2] = pixels[source + 2] >> 8;
      } else {
        const pixels = decoded.data as Uint8Array;
        rgba[target] = pixels[source];
        rgba[target + 1] = pixels[source + 1];
        rgba[target + 2] = pixels[source + 2];
      }
      rgba[target + 3] = 255;
    }

    const imageData = new ImageData(rgba, decoded.width, decoded.height);
    return {
      bitmap: await createImageBitmap(imageData),
      format: extensionOf(file) === "rw2" ? "Panasonic RW2" : "Apple ProRAW DNG",
      note: "RAW 已使用相机白平衡转换为 sRGB；导出文件不保留原始 EXIF。",
    };
  } finally {
    raw.dispose();
  }
}

export async function decodePhoto(file: File): Promise<DecodedPhoto> {
  const extension = extensionOf(file);

  if (["heic", "heif"].includes(extension) || /hei[cf]/i.test(file.type)) {
    return decodeHeic(file);
  }
  if (["dng", "rw2"].includes(extension)) {
    return decodeRaw(file);
  }

  return {
    bitmap: await bitmapFromBlob(file),
    format: extension ? extension.toUpperCase() : "图片",
    note: "照片已按浏览器色彩管理转换；导出文件不保留原始 EXIF。",
  };
}
