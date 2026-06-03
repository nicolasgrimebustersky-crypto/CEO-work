# Adding your real job photos

The site currently uses tasteful on-brand **placeholder image slots** so everything
looks finished. Swapping in your real photos takes seconds — no code knowledge needed.

## 1. Drop your photos into `public/photos/`

Recommended names (any common image format works — `.jpg`, `.png`, `.webp`):

| File                         | Where it shows up                          |
| ---------------------------- | ------------------------------------------ |
| `public/photos/before-1.jpg` | "Before" panel in the Transformations card |
| `public/photos/after-1.jpg`  | "After" panel in the Transformations card  |
| `public/photos/founders.jpg` | "Meet the crew" section                    |

## 2. Point the component at the file

Each placeholder is the `<ImagePlaceholder>` component. Just add a `src` prop:

```tsx
// components/site/transformations.tsx
<ImagePlaceholder src="/photos/before-1.jpg" alt="Before — dirty driveway" />
<ImagePlaceholder src="/photos/after-1.jpg"  alt="After — clean driveway" />

// components/site/founders.tsx
<ImagePlaceholder src="/photos/founders.jpg" alt="Grime Busters KY founders" />
```

That's it — the placeholder disappears and your photo fills the slot.

> Tip: for the best before/after effect, use two photos shot from the same angle.

## Sending them to me instead

You can also just send the photos in chat (or a direct download link / shared
folder) and I'll wire them in and re-deploy for you. Instagram/TikTok/Facebook
block automated downloads, so I can't pull them from your profile directly.
