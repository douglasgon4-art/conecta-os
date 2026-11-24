import { SOCIAL_NETWORKS, labelOf } from "@/lib/domain";

const BASE: Record<string, string> = { facebook: "https://facebook.com/", instagram: "https://instagram.com/", tiktok: "https://www.tiktok.com/@" };

/** Convierte "@usuario" o "usuario" en un enlace; deja intactos los enlaces completos. */
export function socialHref(network: string, value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}\//i.test(value)) return `https://${value}`;
  const handle = value.replace(/^@/, "");
  return BASE[network] ? `${BASE[network]}${handle}` : null;
}

export function SocialLinks({ links }: { links: Record<string, string> | null | undefined }) {
  const entries = Object.entries(links ?? {}).filter(([, v]) => v);
  if (!entries.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2 text-xs">
      {entries.map(([k, v]) => {
        const href = socialHref(k, v);
        return href ? <a key={k} href={href} target="_blank" rel="noreferrer" className="text-brand-700 underline">{labelOf(SOCIAL_NETWORKS, k)}</a> : <span key={k}>{labelOf(SOCIAL_NETWORKS, k)}: {v}</span>;
      })}
    </span>
  );
}
