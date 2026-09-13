/**
 * Icônes en SVG inline.
 *
 * Les maquettes utilisent une fonte d'icônes chargée depuis un CDN. Une app
 * auto-hébergée sur le réseau de la maison ne peut pas dépendre d'un CDN pour
 * afficher ses boutons : une dizaine de tracés inline coûtent moins qu'un
 * écran d'icônes manquantes le jour où la box ne répond pas.
 */
import type { JSX, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const Base = ({ size = 20, children, ...props }: IconProps & { children: JSX.Element }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    {children}
  </svg>
);

export const IconBowl = (p: IconProps) => (
  <Base {...p}>
    <g><path d="M3 11h18a9 9 0 0 1-9 9 9 9 0 0 1-9-9Z" /><path d="M17 4v5" /></g>
  </Base>
);

export const IconHome = (p: IconProps) => (
  <Base {...p}><g><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></g></Base>
);

export const IconWeek = (p: IconProps) => (
  <Base {...p}>
    <g>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </g>
  </Base>
);

export const IconHistory = (p: IconProps) => (
  <Base {...p}><g><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></g></Base>
);

export const IconUsers = (p: IconProps) => (
  <Base {...p}>
    <g>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5M18 20a6 6 0 0 0-2-4.5" />
    </g>
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}><g><path d="M12 5v14M5 12h14" /></g></Base>
);

export const IconMinus = (p: IconProps) => (
  <Base {...p}><g><path d="M5 12h14" /></g></Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}><g><path d="m4 12 5 5L20 6" /></g></Base>
);

export const IconClose = (p: IconProps) => (
  <Base {...p}><g><path d="M6 6l12 12M18 6 6 18" /></g></Base>
);

export const IconSearch = (p: IconProps) => (
  <Base {...p}><g><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></g></Base>
);

export const IconFridge = (p: IconProps) => (
  <Base {...p}>
    <g>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M5 10h14M8 6v2M8 13v3" />
    </g>
  </Base>
);

export const IconLogout = (p: IconProps) => (
  <Base {...p}>
    <g><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" /><path d="M20 12H10m10 0-3-3m3 3-3 3" /></g>
  </Base>
);

export const IconChevron = (p: IconProps) => (
  <Base {...p}><g><path d="m9 5 7 7-7 7" /></g></Base>
);

export const IconLeaf = (p: IconProps) => (
  <Base {...p}><g><path d="M4 20C3 12 8 4 20 4c0 12-8 16-16 16Z" /><path d="M10 14c2-3 5-5 8-6" /></g></Base>
);

export const IconAlert = (p: IconProps) => (
  <Base {...p}><g><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></g></Base>
);

export const IconPencil = (p: IconProps) => (
  <Base {...p}><g><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" /><path d="m14 6 4 4" /></g></Base>
);

export const IconCamera = (p: IconProps) => (
  <Base {...p}>
    <g>
      <path d="M3 8h3l2-3h8l2 3h3v11H3Z" />
      <circle cx="12" cy="13" r="3.5" />
    </g>
  </Base>
);

export const IconStar = (p: IconProps) => (
  <Base {...p}>
    <g><path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8Z" /></g>
  </Base>
);

export const IconTrash = (p: IconProps) => (
  <Base {...p}><g><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></g></Base>
);
