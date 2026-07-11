import fs from 'node:fs';
import path from 'node:path';
import { parseOfficeAsync, type OfficeParserConfig } from 'officeparser';

const PPTX_PARSE_CONFIG: OfficeParserConfig = {
  newlineDelimiter: '\n',
  outputErrorToConsole: false,
  ignoreNotes: false,
  putNotesAtLast: false,
};

export type VectorUploadPayload = { blob: Blob; filename: string };

function normalizeExtractedOfficeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function markdownPayload(name: string, source: string, text: string): VectorUploadPayload {
  const body = [`# ${name}`, '', `Source: ${source}`, '', text, ''].join('\n');
  return {
    blob: new Blob([body], { type: 'text/markdown;charset=utf-8' }),
    filename: `${name}.md`,
  };
}

export async function createVectorUploadPayloadFromPath(
  absPath: string,
  sourcePath: string = path.basename(absPath)
): Promise<VectorUploadPayload> {
  const name = path.basename(absPath);
  if (extOf(name) === 'pptx') {
    const text = normalizeExtractedOfficeText(await parseOfficeAsync(absPath, PPTX_PARSE_CONFIG));
    if (!text) throw new Error('PPTX_EMPTY_TEXT');
    return markdownPayload(name, sourcePath, text);
  }

  const buf = await fs.promises.readFile(absPath);
  return { blob: new Blob([buf]), filename: name };
}

export async function createVectorUploadPayloadFromFile(file: File): Promise<VectorUploadPayload> {
  const name = file.name || 'upload';
  if (extOf(name) === 'pptx') {
    const buf = Buffer.from(await file.arrayBuffer());
    const text = normalizeExtractedOfficeText(await parseOfficeAsync(buf, PPTX_PARSE_CONFIG));
    if (!text) throw new Error('PPTX_EMPTY_TEXT');
    return markdownPayload(name, name, text);
  }

  return { blob: file, filename: name };
}
