/** Validates the provider's byte identity before a resumable Storage upload. */
export function readVideoProbeSize(response: Response, maximumUnrangedBytes: number): number {
  if (response.status === 206) {
    const range = parseContentRange(response.headers.get("content-range"));
    const declaredLength = response.headers.get("content-length");
    if (!range || range.start !== 0 || range.end !== 0 || (declaredLength !== null && declaredLength !== "1")) {
      throw new Error("Provider returned an invalid video probe range.");
    }
    return range.total;
  }
  if (response.status !== 200 || response.headers.has("content-range")) {
    throw new Error("Provider did not honor the video probe.");
  }
  const size = parsePositiveInteger(response.headers.get("content-length"));
  if (size === null || size > maximumUnrangedBytes) {
    throw new Error("Provider did not supply a bounded video size.");
  }
  return size;
}

export async function readVideoRangeBytes(response: Response, start: number, end: number, total: number): Promise<Uint8Array> {
  const expectedLength = end - start + 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)
    || start < 0 || end < start || end >= total) {
    throw new Error("Requested video range is invalid.");
  }
  if (response.status === 206) {
    const range = parseContentRange(response.headers.get("content-range"));
    if (!range || range.start !== start || range.end !== end || range.total !== total) {
      await response.body?.cancel();
      throw new Error("Provider returned a different video byte range.");
    }
  } else if (response.status !== 200 || start !== 0 || expectedLength !== total || response.headers.has("content-range")) {
    await response.body?.cancel();
    throw new Error("Provider did not honor the requested video byte range.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && parsePositiveInteger(declaredLength) !== expectedLength) {
    await response.body?.cancel();
    throw new Error("Provider declared a different video byte count.");
  }
  if (!response.body) throw new Error("Provider returned an empty video response.");
  const result = new Uint8Array(expectedLength);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedLength) throw new Error("Provider exceeded the requested video byte count.");
      result.set(value, offset);
      offset += value.byteLength;
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedLength) throw new Error("Provider returned an incomplete video byte range.");
  return result;
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = value && /^bytes (0|[1-9]\d*)-(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total)
    && total > 0 && end >= start && end < total
    ? { start, end, total }
    : null;
}

function parsePositiveInteger(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
