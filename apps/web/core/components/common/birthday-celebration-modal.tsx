import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { ArrowRight, Rocket, Sparkles, X, Zap } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import GtsSphereLogo from "@/app/assets/logos/gts-sphere.svg?url";
import { UserService } from "@/services/user.service";

const userService = new UserService();

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  life: number;
};

const colors = ["#ffb020", "#ff5630", "#6554c0", "#00b8d9", "#36b37e", "#ff8b00", "#e774bb"];

function CelebrationCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!active || !portalRoot || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0;
    let burstTimer = 0;
    let particles: Particle[] = [];

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const burst = () => {
      const origins = [window.innerWidth * 0.22, window.innerWidth * 0.5, window.innerWidth * 0.78];
      origins.forEach((origin, originIndex) => {
        particles.push(
          ...Array.from({ length: 52 }, (_, index) => {
            const angle = Math.PI * (1.08 + Math.random() * 0.84);
            const speed = 5 + Math.random() * 7;
            return {
              x: origin + (Math.random() - 0.5) * 30,
              y: window.innerHeight * (originIndex === 1 ? 0.17 : 0.25),
              vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2,
              vy: Math.sin(angle) * speed - Math.random() * 2,
              size: 4 + Math.random() * 6,
              rotation: Math.random() * Math.PI,
              rotationSpeed: (Math.random() - 0.5) * 0.3,
              color: colors[(index + originIndex) % colors.length],
              life: 160 + Math.random() * 80,
            };
          })
        );
      });
    };

    const draw = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles = particles.filter((particle) => particle.life > 0 && particle.y < window.innerHeight + 40);
      const modalRect = document.querySelector<HTMLElement>(".birthday-celebration-modal")?.getBoundingClientRect();
      context.save();
      if (modalRect) {
        const gap = 8;
        context.beginPath();
        context.rect(0, 0, window.innerWidth, window.innerHeight);
        context.rect(modalRect.left - gap, modalRect.top - gap, modalRect.width + gap * 2, modalRect.height + gap * 2);
        context.clip("evenodd");
      }
      particles.forEach((particle) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.14;
        particle.vx *= 0.995;
        particle.rotation += particle.rotationSpeed;
        particle.life -= 1;
        context.save();
        context.globalAlpha = Math.min(1, particle.life / 40);
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.65);
        context.restore();
      });
      context.restore();
      frame = window.requestAnimationFrame(draw);
    };

    resize();
    burst();
    draw();
    window.addEventListener("resize", resize);
    burstTimer = window.setInterval(burst, 2600);
    return () => {
      window.removeEventListener("resize", resize);
      window.clearInterval(burstTimer);
      window.cancelAnimationFrame(frame);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [active, portalRoot]);

  if (!portalRoot) return null;

  return createPortal(
    <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-40" />,
    portalRoot
  );
}

const trimGreetingFromMessage = (message?: string, name?: string) => {
  if (!message) return "";
  const firstExclamation = message.indexOf("!");
  if (firstExclamation === -1 || !name) return message;
  const greeting = message.slice(0, firstExclamation).toLocaleLowerCase();
  if (!greeting.includes(name.toLocaleLowerCase())) return message;
  return message.slice(firstExclamation + 1).trim() || message;
};

export function BirthdayCelebrationModal() {
  const { t } = useTranslation();
  const { data, mutate } = useSWR("CURRENT_USER_BIRTHDAY_GREETING", () => userService.birthdayGreeting(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const isOpen = data?.should_show === true;

  const close = async () => {
    if (data) await mutate({ ...data, should_show: false }, false);
    try {
      await userService.acknowledgeBirthdayGreeting();
    } catch {
      // The greeting is already closed for this session. The server will try
      // to persist the acknowledgement again on the next visit.
    }
  };

  const heading = (data?.title || t("calendar.birthday_title")).replace(/[\s!.,?…]+$/u, "");
  const message = trimGreetingFromMessage(data?.message, data?.name);
  const wishes = [
    { icon: Sparkles, label: t("calendar.birthday_wish_inspiration") },
    { icon: Zap, label: t("calendar.birthday_wish_energy") },
    { icon: Rocket, label: t("calendar.birthday_wish_new_heights") },
  ];

  return (
    <>
      <CelebrationCanvas active={isOpen} />
      <ModalCore
        isOpen={isOpen}
        handleClose={close}
        width={EModalWidth.LG}
        position={EModalPosition.CENTER}
        className="birthday-celebration-modal gts-glass-modal-surface !max-w-[540px] overflow-hidden !rounded-[24px] !border !border-subtle !bg-surface-1 !shadow-raised-200"
      >
        <div className="relative overflow-hidden bg-surface-1 text-center">
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className="shadow-sm focus-visible:outline-accent-primary absolute top-4 right-4 z-20 grid size-8 place-items-center rounded-full border border-subtle bg-surface-1/90 text-secondary backdrop-blur-md transition hover:bg-layer-1 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <X className="size-4" />
          </button>

          <div className="birthday-celebration-stage bg-surface-2" aria-hidden>
            <img src={GtsSphereLogo} alt="" className="birthday-celebration-brand-mark" />
            <div className="birthday-celebration-orbit">
              <span className="birthday-celebration-orbit-dot birthday-celebration-orbit-dot-blue" />
              <span className="birthday-celebration-orbit-dot birthday-celebration-orbit-dot-red" />
            </div>
            <div className="birthday-celebration-badge">
              <div className="birthday-celebration-cake">
                <div className="birthday-celebration-flame" />
                <div className="birthday-celebration-candle" />
                <div className="birthday-celebration-cake-top" />
                <div className="birthday-celebration-cake-layer" />
                <div className="birthday-celebration-cake-base" />
              </div>
            </div>
          </div>

          <div className="birthday-celebration-content">
            <div className="birthday-celebration-eyebrow">{t("calendar.birthday_eyebrow")}</div>
            <h2 className="birthday-celebration-title text-primary">
              {heading}
              {data?.name ? (
                <>
                  {", "}
                  <span className="birthday-celebration-name">{data.name}</span>!
                </>
              ) : (
                "!"
              )}
            </h2>
            <p className="birthday-celebration-message text-secondary">{message}</p>

            <div className="birthday-celebration-wishes">
              {wishes.map(({ icon: Icon, label }) => (
                <div key={label} className="birthday-celebration-wish border border-subtle bg-layer-1 text-secondary">
                  <Icon className="size-4 text-accent-primary" strokeWidth={1.8} />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <button type="button" onClick={close} className="birthday-celebration-cta">
              <span>{t("calendar.birthday_cta")}</span>
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </ModalCore>
    </>
  );
}
