"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Минимальный слой данных для клиентских компонентов (ТЗ: без react-query/swr).
 * apiFetch — обертка над fetch (same-origin credentials по умолчанию),
 * разбирает `{error}` из тела; useApi — загрузка GET с refetch.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Нет соединения с сервером");
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Ошибка запроса (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Повторная загрузка; данные не сбрасываются (stale-while-revalidate). */
  refetch: () => Promise<void>;
}

export function useApi<T>(url: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Счетчик поколений отбрасывает ответы устаревших запросов
  const generation = useRef(0);

  const refetch = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const result = await apiFetch<T>(url);
      if (generation.current !== gen) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (generation.current !== gen) return;
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить данные");
    } finally {
      if (generation.current === gen) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void refetch();
    const gen = generation;
    return () => {
      // Инвалидируем ответы после размонтирования
      gen.current += 1;
    };
  }, [refetch]);

  return { data, error, loading, refetch };
}
