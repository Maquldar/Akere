import { baseHeaders, buildUrl, isAuthEndpoint, redirectToLogin } from './client';
import { networkError, toApiError } from './errors';

export type UploadOptions = {
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Extra multipart fields. Objects are JSON-encoded. */
  fields?: Record<string, unknown>;
  /** Multipart field name for files (API.md §0: `file`). */
  fileField?: string;
  query?: Record<string, unknown>;
  /** Called with 0..1 as the request body uploads. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/** Multipart upload with progress (XHR, since fetch has no upload progress). */
export function uploadFiles<T>(path: string, files: File | File[], options: UploadOptions = {}): Promise<T> {
  const method = options.method ?? 'POST';
  const form = new FormData();
  for (const [key, value] of Object.entries(options.fields ?? {})) {
    if (value === undefined || value === null) continue;
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const list = Array.isArray(files) ? files : [files];
  for (const f of list) form.append(options.fileField ?? 'file', f, f.name);

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, buildUrl(path, options.query));
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(baseHeaders(method))) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let parsed: unknown;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        parsed = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve(parsed as T);
      } else {
        if (xhr.status === 401 && !isAuthEndpoint(path)) redirectToLogin();
        reject(toApiError(xhr.status, parsed, xhr.statusText || 'Upload failed'));
      }
    };
    xhr.onerror = () => reject(networkError(new Error('XHR error')));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

