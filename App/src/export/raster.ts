const MAX_PIXELS = 72_000_000;

export type Raster = { canvas: HTMLCanvasElement; scale: number; width: number; height: number };

export function planScale(width: number, height: number, dpi: number): number {
  const wanted = Math.max(0.5, dpi / 96);
  return Math.min(wanted, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
}

async function loadSvg(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The diagram could not be rendered to an image.'));
      image.src = url;
    });
    return image;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function rasterize(svg: string, width: number, height: number, dpi: number): Promise<Raster> {
  const scale = planScale(width, height, dpi);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available in this browser.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const image = await loadSvg(svg);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, scale, width: canvas.width, height: canvas.height };
}

export function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
      type,
      quality,
    );
  });
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const PT_PER_PX = 72 / 96;

export async function svgToPdf(svg: string, width: number, height: number, dpi: number): Promise<Blob> {
  const raster = await rasterize(svg, width, height, dpi);
  const context = raster.canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available in this browser.');
  const { data } = context.getImageData(0, 0, raster.width, raster.height);

  const rgb = new Uint8Array(raster.width * raster.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  const compressed = await deflate(rgb);
  const bytes = buildPdf({
    imageWidth: raster.width,
    imageHeight: raster.height,
    image: compressed,
    pageWidth: width * PT_PER_PX,
    pageHeight: height * PT_PER_PX,
  });
  return new Blob([bytes], { type: 'application/pdf' });
}

type PdfInput = {
  imageWidth: number;
  imageHeight: number;
  image: Uint8Array<ArrayBuffer>;
  pageWidth: number;
  pageHeight: number;
};

function buildPdf({ imageWidth, imageHeight, image, pageWidth, pageHeight }: PdfInput): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (value: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof value === 'string' ? latin1(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

  const object = (id: number, head: string, stream?: Uint8Array<ArrayBuffer>) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${head}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  const w = Math.round(pageWidth * 100) / 100;
  const h = Math.round(pageHeight * 100) / 100;
  const content = latin1(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`);

  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>`,
    image,
  );
  object(5, `<< /Length ${content.length} >>`, content);

  const xrefAt = length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let id = 1; id <= 5; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function latin1(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}
