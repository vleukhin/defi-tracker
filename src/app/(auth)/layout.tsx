/** Layout страниц авторизации: центрированная карточка. */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold tracking-tight">
          DeFi Portfolio Tracker
        </h1>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
