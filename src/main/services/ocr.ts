import { createWorker } from 'tesseract.js'

/**
 * Run OCR on an image file (PNG/JPG/etc.) and return the recognised text.
 *
 * Uses tesseract.js (WASM). The English language data is downloaded on first
 * use, so the very first image import requires an internet connection.
 */
export async function recognizeImage(filePath: string): Promise<string> {
  const worker = await createWorker('eng')
  try {
    const { data } = await worker.recognize(filePath)
    return (data.text ?? '').trim()
  } finally {
    await worker.terminate()
  }
}
