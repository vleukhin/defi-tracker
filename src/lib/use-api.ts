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
    /** Построчные ошибки валидации из `{issues}` — для инлайн-вывода у форм. */
    public readonly issues: string[] = [],
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
    const record =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};
    const message =
      typeof record.error === "string"
        ? record.error
        : `Ошибка запроса (${res.status})`;
    const issues = Array.isArray(record.issues)
      ? record.issues.filter((i): i is string => typeof i === "string")
      : [];
    throw new ApiError(res.status, message, issues);
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

  const refetch = useCallback((): Promise<void> => {
    const gen = ++generation.current;
    // Промис-цепочка вместо async-тела: setState только в колбэках ответа,
    // синхронного setState нет (react-hooks/set-state-in-effect)
    return apiFetch<T>(url).then(
      (result) => {
        if (generation.current !== gen) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (generation.current !== gen) return;
        setError(
          e instanceof ApiError ? e.message : "Не удалось загрузить данные",
        );
        setLoading(false);
      },
    );
  }, [url]);

  useEffect(() => {
    void refetch();
    const gen = generation;
    return () => {
      // Инвалидируем ответы после размонтирования
      gen.current += 1;
    };
  }, [refetch]);

  /*
   * Возврат в приложение перечитывает данные.
   *
   * Экран живёт на таймере автообновления, но мобильные браузеры душат
   * таймеры в фоновых вкладках и восстанавливают страницу из bfcache
   * целиком, вместе со старым состоянием React. Типичный сценарий —
   * вкладка открыта со вчера: пользователь переключается на неё утром и
   * видит вчерашние числа без единого признака, что они несвежие.
   * По docs/07 §7 решение принимается по цене, закрепившейся за 48 часов;
   * принимать его по суточным данным нельзя.
   *
   * Это дешёвый GET из кэша сервера, а не POST /api/refresh: дорогое
   * обновление по-прежнему решает needsRefreshOnEnter (refresh-policy).
   *
   * pageshow с persisted нужен отдельно от visibilitychange: при возврате
   * из bfcache Safari не всегда меняет видимость документа.
   */
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refetch();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) void refetch();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refetch]);

  return { data, error, loading, refetch };
}
