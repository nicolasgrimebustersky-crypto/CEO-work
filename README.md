# Grime Bustersky — Website Revamp

A revamped marketing site for **Grime Busters KY** — Louisville's pressure washing
& landscaping crew. Built with **Next.js 16 (App Router) + TypeScript + Tailwind CSS v4**
in a **shadcn**-style project structure.

Branded in the logo's **emerald green + cream** palette on a deep green-black theme,
with a high-impact animated hero.

## Tech & structure

- **Framework:** Next.js 16 (App Router, RSC)
- **Styling:** Tailwind CSS v4, design tokens in `app/globals.css`
- **Structure:** shadcn conventions — UI primitives in `components/ui`, page
  sections in `components/site`, helpers in `lib/utils.ts` (`components.json` present)

### Integrated UI components (`components/ui/`)

| Component                       | Used for                                              | Deps                                    |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| `web-gl-shader.tsx`             | Animated emerald hero background (retuned to brand)   | `three`                                 |
| `container-scroll-animation.tsx`| Scroll-reveal Before/After showcase                   | `framer-motion`                         |
| `liquid-glass-button.tsx`       | `LiquidButton` / `MetalButton` CTAs                   | `@radix-ui/react-slot`, `cva`           |
| `heroui-date-picker.tsx`        | "Preferred date" in the booking form                  | —                                       |

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the build
```

## Your photos

The site ships with on-brand placeholder image slots. See **[PHOTOS.md](./PHOTOS.md)**
for the 2-step way to drop in your real before/after and team photos.

## Business details

Edit `components/site/site-data.ts` to change phone, hours, services, testimonials, etc.
Current: **(502) 599-6855** · Mon–Sun 9 AM–7 PM · Louisville, KY.
