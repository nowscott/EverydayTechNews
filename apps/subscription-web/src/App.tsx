import { useEffect, useState, type FormEvent } from "react";
import { confirmSubscription, subscribe } from "./api";

type SubmissionState =
  | { mode: "idle"; message: "" }
  | { mode: "confirmation"; message: string }
  | { mode: "loading"; message: string }
  | { mode: "success"; message: string }
  | { mode: "error"; message: string };

const INITIAL_STATE: SubmissionState = { mode: "idle", message: "" };

function initialSubmissionState(): SubmissionState {
  if (
    new URLSearchParams(window.location.search).has("confirmation_token")
  ) {
    return {
      mode: "confirmation",
      message: "请点击下方按钮完成邮箱确认。此链接只能成功使用一次。",
    };
  }

  const confirmation = new URLSearchParams(window.location.search).get(
    "confirmation",
  );
  const messages: Record<string, SubmissionState> = {
    confirmed: {
      mode: "success",
      message: "邮箱确认完成，下一期科技早报将发送到你的邮箱。",
    },
    used: {
      mode: "success",
      message: "这个确认链接已经使用过，你的订阅已生效。",
    },
    expired: {
      mode: "error",
      message: "确认链接已过期，请重新提交邮箱获取新链接。",
    },
    invalid: {
      mode: "error",
      message: "确认链接无效，请重新提交邮箱获取新链接。",
    },
    error: {
      mode: "error",
      message: "暂时无法确认订阅，请稍后再次打开邮件中的链接。",
    },
  };
  return confirmation ? messages[confirmation] || INITIAL_STATE : INITIAL_STATE;
}

function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current">
      <rect x="3" y="5" width="18" height="14" rx="1" strokeWidth="1.6" />
      <path d="m4 7 8 6 8-6" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current">
      <path d="M5 12h13M14 7l5 5-5 5" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current">
      <path d="m5 12 4 4L19 6" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export default function App() {
  const [state, setState] = useState<SubmissionState>(initialSubmissionState);
  const [isConfirmationFlow] = useState(() =>
    new URLSearchParams(window.location.search).has("confirmation_token"),
  );
  const [confirmationToken, setConfirmationToken] = useState(() =>
    new URLSearchParams(window.location.search).get("confirmation_token"),
  );

  useEffect(() => {
    if (confirmationToken) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [confirmationToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.mode === "loading") return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    setState({ mode: "loading", message: "正在登记你的订阅信息…" });

    try {
      const result = await subscribe({
        name: String(formData.get("name") || ""),
        email: String(formData.get("email") || ""),
        company: String(formData.get("company") || ""),
      });
      setState({ mode: "success", message: result.message });
      form.reset();
    } catch (error) {
      setState({
        mode: "error",
        message: error instanceof Error ? error.message : "订阅失败，请稍后重试。",
      });
    }
  }

  async function handleConfirmation() {
    if (!confirmationToken || state.mode === "loading") return;
    setState({ mode: "loading", message: "正在确认你的邮箱…" });

    try {
      const result = await confirmSubscription(confirmationToken);
      setState({ mode: "success", message: result.message });
      setConfirmationToken(null);
    } catch (error) {
      setState({
        mode: "error",
        message:
          error instanceof Error
            ? error.message
            : "暂时无法确认订阅，请稍后重试。",
      });
    }
  }

  const isLoading = state.mode === "loading";

  if (isConfirmationFlow) {
    return (
      <main className="page-grid min-h-screen text-[#172126] dark:text-[#e7e4d9]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-6 sm:px-8 sm:py-8">
          <header className="flex items-center border-b border-[#cfd7d5] pb-5 dark:border-[#354244]">
            <a href="/" className="flex items-center gap-3 no-underline">
              <span className="grid size-10 place-items-center border border-[#bd4f32] bg-[#bd4f32] text-[#fffaf1] dark:border-[#dd7659] dark:bg-[#dd7659] dark:text-[#101719]">
                <MailIcon />
              </span>
              <span>
                <strong className="block text-base tracking-tight">每日科技早报</strong>
                <span className="mt-0.5 block font-mono text-[10px] tracking-[0.16em] text-[#637078] dark:text-[#aab1ae]">
                  EVERYDAY TECH NEWS
                </span>
              </span>
            </a>
          </header>

          <section className="flex flex-1 items-center justify-center py-14">
            <div className="relative w-full max-w-xl">
              <div
                aria-hidden="true"
                className="absolute -inset-3 translate-x-3 translate-y-3 border border-[#bd4f32]/35 dark:border-[#dd7659]/30"
              />
              <div className="relative border border-[#cbd4d2] bg-[rgba(255,254,249,0.94)] p-7 shadow-[0_28px_90px_rgba(35,48,48,0.12)] sm:p-10 dark:border-[#3a4647] dark:bg-[rgba(24,33,36,0.96)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.32)]">
                <p className="font-mono text-[11px] font-bold tracking-[0.16em] text-[#bd4f32] dark:text-[#dd7659]">
                  EMAIL CONFIRMATION
                </p>
                <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em]">
                  确认邮件订阅
                </h1>

                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-7 border px-5 py-4 text-sm leading-7 ${
                    state.mode === "error"
                      ? "border-[#bd4f32]/45 bg-[#bd4f32]/5 text-[#8c3521] dark:border-[#dd7659]/45 dark:text-[#f0a18b]"
                      : state.mode === "success"
                        ? "border-[#2f6f62]/40 bg-[#2f6f62]/5 text-[#24564c] dark:border-[#79b3a5]/40 dark:text-[#93c8bb]"
                        : "border-[#cbd4d2] text-[#637078] dark:border-[#3a4647] dark:text-[#aab1ae]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {state.mode === "success" && <CheckIcon />}
                    <span className="flex-1">{state.message}</span>
                  </div>

                  {state.mode === "confirmation" && confirmationToken && (
                    <button
                      type="button"
                      onClick={handleConfirmation}
                      className="mt-5 flex w-full cursor-pointer items-center justify-center border-0 bg-[#bd4f32] px-5 py-3.5 font-bold text-[#fffaf1] transition hover:bg-[#8c3521] dark:bg-[#dd7659] dark:text-[#101719] dark:hover:bg-[#c86448]"
                    >
                      确认订阅
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page-grid min-h-screen text-[#172126] dark:text-[#e7e4d9]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-[#cfd7d5] pb-5 dark:border-[#354244]">
          <a href="/" className="flex items-center gap-3 no-underline">
            <span className="grid size-10 place-items-center border border-[#bd4f32] bg-[#bd4f32] text-[#fffaf1] dark:border-[#dd7659] dark:bg-[#dd7659] dark:text-[#101719]">
              <MailIcon />
            </span>
            <span>
              <strong className="block text-base tracking-tight">每日科技早报</strong>
              <span className="mt-0.5 block font-mono text-[10px] tracking-[0.16em] text-[#637078] dark:text-[#aab1ae]">
                EVERYDAY TECH NEWS
              </span>
            </span>
          </a>
          <span className="hidden border border-[#b9cbc5] px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-[#2f6f62] sm:block dark:border-[#466860] dark:text-[#79b3a5]">
            DAILY · 07:23 CST
          </span>
        </header>

        <section className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:gap-20 lg:py-20">
          <div className="max-w-2xl">
            <p className="mb-5 font-mono text-xs font-bold tracking-[0.2em] text-[#bd4f32] dark:text-[#dd7659]">
              CURATED, NOT CROWDED
            </p>
            <h1 className="max-w-[12ch] text-[clamp(3.4rem,8vw,6.9rem)] leading-[0.94] font-bold tracking-[-0.065em]">
              每天一封，
              <span className="block text-[#bd4f32] dark:text-[#dd7659]">刚好读完。</span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-8 text-[#59666d] sm:text-lg dark:text-[#aab1ae]">
              从全天科技资讯中筛选、去重并排序，只保留值得关注的 25 条新闻。
              没有信息轰炸，也不需要不断刷新页面。
            </p>

            <div className="mt-10 grid max-w-xl grid-cols-3 border-y border-[#cfd7d5] py-5 dark:border-[#354244]">
              {[
                ["25", "每日精选"],
                ["0", "推广内容"],
                ["1", "封邮件"],
              ].map(([value, label]) => (
                <div
                  key={label}
                  className="border-r border-[#d8dfdf] px-3 first:pl-0 last:border-0 dark:border-[#354244]"
                >
                  <strong className="block text-2xl text-[#2f6f62] dark:text-[#79b3a5]">
                    {value}
                  </strong>
                  <span className="mt-1 block text-xs text-[#637078] dark:text-[#aab1ae]">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-3 translate-x-3 translate-y-3 border border-[#bd4f32]/35 dark:border-[#dd7659]/30"
            />
            <section className="relative border border-[#cbd4d2] bg-[rgba(255,254,249,0.94)] p-6 shadow-[0_28px_90px_rgba(35,48,48,0.12)] sm:p-9 dark:border-[#3a4647] dark:bg-[rgba(24,33,36,0.96)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.32)]">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="font-mono text-[11px] font-bold tracking-[0.16em] text-[#bd4f32] dark:text-[#dd7659]">
                    SUBSCRIPTION
                  </p>
                  <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em]">加入邮件列表</h2>
                </div>
                <span className="grid size-10 place-items-center border border-[#b9cbc5] text-[#2f6f62] dark:border-[#466860] dark:text-[#79b3a5]">
                  <span className="size-2 bg-current" />
                </span>
              </div>

              <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold">你的称呼</span>
                    <input
                      name="name"
                      type="text"
                      autoComplete="name"
                      required
                      minLength={1}
                      maxLength={50}
                      placeholder="例如：小林"
                      className="w-full rounded-none border border-[#9eaaa8] bg-white/35 px-4 py-3.5 text-base outline-none transition placeholder:text-[#8a9598] focus:border-[#bd4f32] focus:ring-2 focus:ring-[#bd4f32]/15 dark:border-[#536264] dark:bg-white/[0.025] dark:placeholder:text-[#778285] dark:focus:border-[#dd7659] dark:focus:ring-[#dd7659]/20"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold">接收邮箱</span>
                    <input
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      placeholder="you@example.com"
                      className="w-full rounded-none border border-[#9eaaa8] bg-white/35 px-4 py-3.5 font-sans text-base outline-none transition placeholder:text-[#8a9598] focus:border-[#bd4f32] focus:ring-2 focus:ring-[#bd4f32]/15 dark:border-[#536264] dark:bg-white/[0.025] dark:placeholder:text-[#778285] dark:focus:border-[#dd7659] dark:focus:ring-[#dd7659]/20"
                    />
                  </label>

                  <label className="absolute -left-[9999px]" aria-hidden="true">
                    公司
                    <input name="company" type="text" tabIndex={-1} autoComplete="off" />
                  </label>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex w-full cursor-pointer items-center justify-between rounded-none border-0 bg-[#bd4f32] px-5 py-4 text-left text-[#fffaf1] transition hover:bg-[#8c3521] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd4f32] disabled:cursor-wait disabled:opacity-65 dark:bg-[#dd7659] dark:text-[#101719] dark:hover:bg-[#c86448]"
                  >
                    <span className="text-base font-bold">
                      {isLoading ? "正在订阅" : "订阅每日早报"}
                    </span>
                    {isLoading ? (
                      <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <ArrowIcon />
                    )}
                  </button>
              </form>

              {state.mode !== "idle" && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-5 flex items-start gap-3 border px-4 py-3.5 text-sm leading-6 ${
                    state.mode === "error"
                      ? "border-[#bd4f32]/45 bg-[#bd4f32]/5 text-[#8c3521] dark:border-[#dd7659]/45 dark:text-[#f0a18b]"
                      : state.mode === "success"
                        ? "border-[#2f6f62]/40 bg-[#2f6f62]/5 text-[#24564c] dark:border-[#79b3a5]/40 dark:text-[#93c8bb]"
                        : "border-[#cbd4d2] text-[#637078] dark:border-[#3a4647] dark:text-[#aab1ae]"
                  }`}
                >
                  {state.mode === "success" && <CheckIcon />}
                  <div className="flex-1">
                    <span>{state.message}</span>
                    {state.mode === "confirmation" && confirmationToken && (
                      <button
                        type="button"
                        onClick={handleConfirmation}
                        className="mt-5 flex w-full cursor-pointer items-center justify-center border-0 bg-[#bd4f32] px-5 py-3.5 font-bold text-[#fffaf1] transition hover:bg-[#8c3521] dark:bg-[#dd7659] dark:text-[#101719] dark:hover:bg-[#c86448]"
                      >
                        确认订阅
                      </button>
                    )}
                  </div>
                </div>
              )}

              <p className="mt-5 text-xs leading-6 text-[#6f7b80] dark:text-[#929c99]">
                提交后需在 24 小时内通过邮件确认。我们只将邮箱用于发送订阅内容，不会出售或共享。
              </p>
            </section>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-[#cfd7d5] pt-5 text-xs text-[#637078] sm:flex-row sm:items-center sm:justify-between dark:border-[#354244] dark:text-[#929c99]">
          <span>新闻来自公开信息源，经自动过滤与排序。</span>
          <a
            href="https://github.com/nowscott/EverydayTechNews"
            target="_blank"
            rel="noreferrer"
            className="font-mono tracking-[0.08em] text-[#2f6f62] underline decoration-[#b9cbc5] underline-offset-4 dark:text-[#79b3a5] dark:decoration-[#466860]"
          >
            VIEW SOURCE ON GITHUB
          </a>
        </footer>
      </div>
    </main>
  );
}
