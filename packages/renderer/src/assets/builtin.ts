import {
  Bell,
  Bike,
  Bot,
  Car,
  Clock,
  Cloud,
  Coffee,
  Cpu,
  CreditCard,
  Crown,
  Database,
  FileText,
  Globe,
  HardDrive,
  Key,
  Layers,
  List,
  Lock,
  Mail,
  MapPin,
  Package,
  Pizza,
  Server,
  Shield,
  ShoppingBag,
  Smartphone,
  Ticket,
  User,
  Users,
  Zap,
  type IconNode,
} from 'lucide';

/**
 * TEMPORARY built-in asset set until the asset library (P1A.11) replaces it. React-free: the
 * validator reads the ids (`unknown_asset` warnings) and components draw the glyphs.
 *
 * Glyphs are Lucide icons (https://lucide.dev, ISC licence), drawn with theme strokes. `icon`
 * assets are infrastructure and concept glyphs; `item` assets are everyday objects.
 */

export const ASSET_KINDS = ['icon', 'item'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export type Asset = {
  id: string;
  kind: AssetKind;
  /** Plain name, shown by the placeholder and in catalogues. */
  label: string;
  /** SVG elements in a 24×24 viewBox, stroked (no fills). */
  glyph: IconNode;
};

export type AssetRegistry = ReadonlyMap<string, Asset>;

const icon = (id: string, label: string, glyph: IconNode): Asset => ({
  id,
  kind: 'icon',
  label,
  glyph,
});
const item = (id: string, label: string, glyph: IconNode): Asset => ({
  id,
  kind: 'item',
  label,
  glyph,
});

export const BUILTIN_ASSETS: readonly Asset[] = [
  icon('server', 'Server', Server),
  icon('database', 'Database', Database),
  icon('disk', 'Disk', HardDrive),
  icon('cpu', 'CPU', Cpu),
  icon('cloud', 'Cloud', Cloud),
  icon('globe', 'Internet', Globe),
  icon('user', 'User', User),
  icon('users', 'Users', Users),
  icon('lock', 'Lock', Lock),
  icon('key', 'Key', Key),
  icon('shield', 'Shield', Shield),
  icon('zap', 'Fast', Zap),
  icon('clock', 'Clock', Clock),
  icon('list', 'List', List),
  icon('layers', 'Layers', Layers),
  icon('mail', 'Message', Mail),
  icon('bell', 'Notification', Bell),
  icon('bot', 'Bot', Bot),
  icon('crown', 'Leader', Crown),
  item('smartphone', 'Phone', Smartphone),
  item('car', 'Car', Car),
  item('bike', 'Bike', Bike),
  item('ticket', 'Ticket', Ticket),
  item('package', 'Parcel', Package),
  item('shopping_bag', 'Shopping bag', ShoppingBag),
  item('credit_card', 'Card', CreditCard),
  item('pizza', 'Pizza', Pizza),
  item('coffee', 'Coffee', Coffee),
  item('document', 'Document', FileText),
  item('map_pin', 'Location', MapPin),
];

export function buildAssetRegistry(assets: readonly Asset[]): AssetRegistry {
  const registry = new Map<string, Asset>();
  for (const asset of assets) {
    if (registry.has(asset.id)) throw new Error(`Duplicate asset id "${asset.id}"`);
    registry.set(asset.id, asset);
  }
  return registry;
}

export const ASSETS: AssetRegistry = buildAssetRegistry(BUILTIN_ASSETS);

/** The asset for an id; undefined for unknown ids (drawn as a neutral placeholder). */
export function getAsset(id: string, registry: AssetRegistry = ASSETS): Asset | undefined {
  return registry.get(id);
}
