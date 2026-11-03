/**
 * Простой token bucket для рейт-лимита исходящих вызовов
 * (CoinGecko: 25 req/мин, ТЗ Часть 4 §4). Чистая логика — тестируется
 * с инъекцией времени, без таймеров.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  /** Скорость пополнения, токенов в миллисекунду. */
  private readonly refillPerMs: number;
  private readonly now: () => number;

  /**
   * Поля объявлены отдельно, а не параметрами конструктора: parameter
   * properties — единственная конструкция TypeScript, которая не является
   * разметкой типов, и снять её простым стиранием нельзя. Скрипты
   * (scripts/restore-snapshot.ts) исполняют код приложения прямо в Node,
   * а Node умеет ровно стирание, — и один такой конструктор делал бы
   * незагружаемым всё, что тянет за собой кэш цен.
   */
  constructor(
    capacity: number,
    refillPerMs: number,
    now: () => number = Date.now,
  ) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.now = now;
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = t;
    }
  }

  /** Пытается взять токен; true = можно выполнять запрос. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Мс до появления следующего токена (0 = уже доступен). */
  msUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }

  /** Ждет доступный токен и забирает его. */
  async take(sleep: (ms: number) => Promise<void> = defaultSleep): Promise<void> {
    while (!this.tryTake()) {
      await sleep(Math.max(this.msUntilNextToken(), 10));
    }
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** CoinGecko Demo: закладываемся на 25/мин (заявлено ~30, ТЗ §2). */
export const createCoingeckoBucket = () => new TokenBucket(25, 25 / 60_000);
