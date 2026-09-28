/**
 * @jest-environment jsdom
 */

import { extractPdfStatement, pdfSupportAssets } from "./pdfClient";

const getDocument = jest.fn();
const renderCalls: Record<string, unknown>[] = [];

jest.mock("pdfjs-dist/webpack.mjs", () => ({
  getDocument: (options: Record<string, unknown>) => getDocument(options),
}));

function fakePage() {
  return {
    getTextContent: async () => ({
      items: [
        { str: "Date", transform: [1, 0, 0, 1, 20, 740], width: 20, height: 10, dir: "ltr", fontName: "f1", hasEOL: false },
        // Marked content carries no text and is filtered out, not cast.
        { type: "beginMarkedContent", tag: "P" },
      ],
    }),
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      rotation: 0,
      transform: [scale, 0, 0, -scale, 0, 792 * scale],
    }),
    render: (params: Record<string, unknown>) => {
      renderCalls.push(params);
      return { promise: Promise.resolve() };
    },
    cleanup: jest.fn(),
  };
}

/** jsdom's File has no arrayBuffer(); the adapter needs only that and the size. */
function pdfFile() {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer } as unknown as File;
}

beforeEach(() => {
  getDocument.mockReset();
  renderCalls.length = 0;
  getDocument.mockImplementation(() => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => fakePage() }),
    destroy: jest.fn(async () => {}),
  }));
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({}) as unknown as CanvasRenderingContext2D
  );
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback) {
    callback(null);
  };
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/webp;base64,";
});

afterEach(() => jest.restoreAllMocks());

describe("PDF.js adapter", () => {
  it("points PDF.js at the character maps, fonts, decoders and colour profiles the app serves", () => {
    expect(pdfSupportAssets("https://bench.example")).toEqual({
      cMapUrl: "https://bench.example/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "https://bench.example/pdfjs/standard_fonts/",
      wasmUrl: "https://bench.example/pdfjs/wasm/",
      iccUrl: "https://bench.example/pdfjs/iccs/",
    });
  });

  it("opens a PDF with absolute asset URLs and without options PDF.js 6 removed", async () => {
    await extractPdfStatement(pdfFile());

    const options = getDocument.mock.calls[0][0];
    expect(options.data).toBeInstanceOf(Uint8Array);
    expect(options).toMatchObject(pdfSupportAssets(window.location.origin));
    expect(options).not.toHaveProperty("isEvalSupported");
  });

  it("gives the preview render the canvas PDF.js 6 requires", async () => {
    await extractPdfStatement(pdfFile());

    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0].canvas).toBeInstanceOf(HTMLCanvasElement);
  });
});
