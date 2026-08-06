import { ImageResponse } from "next/og";

/**
 * Иконка для домашнего экрана iOS: Apple не принимает SVG, поэтому знак
 * из src/components/logo.tsx перерисован кодом в PNG.
 *
 * Геометрия — LogoMark, умноженный на 7.5 (180 / 24): полосы возрастающей
 * высоты цветами зон Growth / Yield / Stability, выровненные по низу.
 * Цвета — литералы токенов тёмной темы: сюда CSS-переменные не доходят.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const BARS = [
  { height: 45, color: "#d6a159" }, // growth
  { height: 75, color: "#8a7bf0" }, // yield
  { height: 105, color: "#38a9c4" }, // stability
];

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 19,
          paddingBottom: 38,
          background: "#151a20",
        }}
      >
        {BARS.map((bar) => (
          <div
            key={bar.color}
            style={{
              width: 22,
              height: bar.height,
              borderRadius: 4,
              background: bar.color,
            }}
          />
        ))}
      </div>
    ),
    size,
  );
}
