import type { AssetFamily, LibraryAsset } from '@explainer-studio/shared';
import {
  AppWindow,
  Archive,
  ArrowLeftRight,
  Banknote,
  Bell,
  Bike,
  Binary,
  Blocks,
  BookOpen,
  Bot,
  Boxes,
  Braces,
  Brain,
  Bug,
  BuildingComplex,
  Calendar,
  Car,
  ChartColumn,
  ChartLine,
  Check,
  CircleCheck,
  CircleX,
  CircuitBoard,
  Clock,
  Cloud,
  Code,
  Coffee,
  Container,
  Copy,
  Cpu,
  CreditCard,
  Crown,
  Database,
  Eye,
  FileText,
  FingerprintPattern,
  Flag,
  Funnel,
  Gamepad2,
  Gauge,
  GitBranch,
  Globe,
  Gpu,
  HardDrive,
  Hash,
  Hourglass,
  House,
  Image,
  Inbox,
  Key,
  Laptop,
  Layers,
  Link,
  List,
  ListOrdered,
  Lock,
  LockOpen,
  Mail,
  MapPin,
  MemoryStick,
  MessageSquare,
  Monitor,
  MousePointer2,
  Network,
  Package,
  Pizza,
  Plane,
  Receipt,
  RefreshCw,
  Repeat,
  Rocket,
  RotateCcwClock,
  Route,
  Router,
  Scale,
  ScanText,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Shuffle,
  Smartphone,
  Sparkles,
  Split,
  Star,
  Store,
  Table,
  Terminal,
  ThumbsUp,
  Ticket,
  Timer,
  TriangleExclamationPoint,
  Truck,
  User,
  UserCheck,
  Users,
  UserX,
  Video,
  WandSparkles,
  Waypoints,
  Wifi,
  X,
  Zap,
  type IconNode,
} from 'lucide';
import { HOUSE_STYLE_VERSION, restyleIconNode } from './house-svg.ts';

/**
 * The seed library: curated Lucide icons (https://lucide.dev), restyled to the house style
 * (`restyleIconNode`) and copied into `<DATA_DIR>/assets` by the studio's seeding step. The
 * renderer also uses it directly when a render is given no assets (Studio, stills, fixtures).
 *
 * Licences: Lucide is ISC; icons Lucide derived from Feather are also MIT (both texts in
 * `LICENSE-lucide.txt`, a test checks the list against the installed package's licence).
 */

/** Installed `lucide` version (a test checks it against `node_modules`). */
export const LUCIDE_VERSION = '1.74.0';

/** Lucide icons derived from Feather (current Lucide names), so licensed ISC AND MIT. */
export const FEATHER_DERIVED = new Set([
  'calendar',
  'check',
  'circle-x',
  'clock',
  'code',
  'database',
  'hash',
  'key',
  'link',
  'lock',
  'monitor',
  'search',
  'server',
  'shopping-bag',
  'smartphone',
  'terminal',
  'triangle-exclamation-point',
  'x',
]);

type SeedEntry = {
  id: string;
  name: string;
  family: AssetFamily;
  tags: string[];
  /** Lucide's canonical export name (its file name in PascalCase), e.g. `HardDrive`. */
  lucide: string;
  node: IconNode;
};

const entry =
  (family: AssetFamily) =>
  (id: string, name: string, [lucide, node]: [string, IconNode], tags: string[]): SeedEntry => ({
    id,
    name,
    family,
    tags,
    lucide,
    node,
  });

const infra = entry('infra');
const network = entry('network');
const data = entry('data');
const security = entry('security');
const people = entry('people');
const ai = entry('ai');
const time = entry('time');
const object = entry('object');
const transport = entry('transport');
const ui = entry('ui');
const symbol = entry('symbol');
const dev = entry('dev');

const SEED_ENTRIES: readonly SeedEntry[] = [
  infra('server', 'Server', ['Server', Server], ['host', 'machine', 'backend', 'service']),
  infra('database', 'Database', ['Database', Database], ['db', 'storage', 'sql', 'store']),
  infra('disk', 'Disk', ['HardDrive', HardDrive], ['storage', 'drive', 'ssd']),
  infra('cpu', 'CPU', ['Cpu', Cpu], ['processor', 'compute', 'core']),
  infra('memory', 'Memory', ['MemoryStick', MemoryStick], ['ram', 'cache', 'in-memory']),
  infra('cloud', 'Cloud', ['Cloud', Cloud], ['hosted', 'provider', 'region']),
  infra('layers', 'Layers', ['Layers', Layers], ['stack', 'tiers', 'levels']),
  infra('container', 'Container', ['Container', Container], ['docker', 'image', 'deploy']),
  infra('cluster', 'Cluster', ['Boxes', Boxes], ['pods', 'replicas', 'fleet']),
  infra(
    'datacenter',
    'Data centre',
    ['BuildingComplex', BuildingComplex],
    ['region', 'site', 'building'],
  ),
  infra('circuit', 'Circuit board', ['CircuitBoard', CircuitBoard], ['hardware', 'chip']),
  network('globe', 'Internet', ['Globe', Globe], ['web', 'world', 'public']),
  network('router', 'Router', ['Router', Router], ['gateway', 'switch']),
  network('wifi', 'Wi-Fi', ['Wifi', Wifi], ['wireless', 'signal', 'connection']),
  network('network', 'Network', ['Network', Network], ['topology', 'nodes', 'lan']),
  network('link', 'Link', ['Link', Link], ['url', 'connection', 'reference']),
  network('split', 'Split', ['Split', Split], ['load balancer', 'fan out', 'route']),
  network('waypoints', 'Hops', ['Waypoints', Waypoints], ['path', 'graph', 'peers']),
  network('swap', 'Exchange', ['ArrowLeftRight', ArrowLeftRight], ['request', 'response']),
  data('list', 'List', ['List', List], ['items', 'records', 'rows']),
  data('queue', 'Queue', ['ListOrdered', ListOrdered], ['ordered', 'fifo', 'backlog']),
  data('document', 'Document', ['FileText', FileText], ['file', 'page', 'text']),
  data('table', 'Table', ['Table', Table], ['rows', 'columns', 'schema']),
  data('hash', 'Hash', ['Hash', Hash], ['key', 'checksum', 'shard']),
  data('json', 'JSON', ['Braces', Braces], ['payload', 'object', 'api']),
  data('search', 'Search', ['Search', Search], ['lookup', 'query', 'find']),
  data('filter', 'Filter', ['Funnel', Funnel], ['funnel', 'match', 'where']),
  data('archive', 'Archive', ['Archive', Archive], ['backup', 'cold storage', 'box']),
  data('bar_chart', 'Bar chart', ['ChartColumn', ChartColumn], ['metrics', 'stats']),
  data('line_chart', 'Line chart', ['ChartLine', ChartLine], ['trend', 'latency', 'graph']),
  data('copy', 'Copy', ['Copy', Copy], ['replica', 'duplicate', 'clone']),
  data('binary', 'Bits', ['Binary', Binary], ['bytes', 'encoding', 'raw']),
  data('inbox', 'Inbox', ['Inbox', Inbox], ['incoming', 'tray', 'buffer']),
  data('shuffle', 'Shuffle', ['Shuffle', Shuffle], ['random', 'rebalance', 'mix']),
  security('lock', 'Lock', ['Lock', Lock], ['locked', 'mutex', 'secure']),
  security('unlock', 'Unlocked', ['LockOpen', LockOpen], ['open', 'released', 'free']),
  security('key', 'Key', ['Key', Key], ['secret', 'token', 'credential']),
  security('shield', 'Shield', ['Shield', Shield], ['protection', 'firewall', 'guard']),
  security('shield_check', 'Verified', ['ShieldCheck', ShieldCheck], ['safe', 'trusted']),
  security(
    'fingerprint',
    'Fingerprint',
    ['FingerprintPattern', FingerprintPattern],
    ['identity', 'auth'],
  ),
  security('eye', 'Watch', ['Eye', Eye], ['visible', 'monitor', 'observe']),
  people('user', 'User', ['User', User], ['person', 'customer', 'client']),
  people('users', 'Users', ['Users', Users], ['people', 'crowd', 'audience']),
  people('user_check', 'Approved user', ['UserCheck', UserCheck], ['verified', 'allowed']),
  people('user_x', 'Blocked user', ['UserX', UserX], ['denied', 'banned']),
  ai('bot', 'Bot', ['Bot', Bot], ['agent', 'assistant', 'llm']),
  ai('brain', 'Brain', ['Brain', Brain], ['model', 'reasoning', 'neural']),
  ai('sparkles', 'Sparkles', ['Sparkles', Sparkles], ['generate', 'ai', 'magic']),
  ai('wand', 'Wand', ['WandSparkles', WandSparkles], ['generate', 'transform']),
  ai('gpu', 'GPU', ['Gpu', Gpu], ['accelerator', 'training', 'inference']),
  ai('scan_text', 'Read text', ['ScanText', ScanText], ['tokenize', 'ocr', 'parse']),
  time('clock', 'Clock', ['Clock', Clock], ['time', 'latency', 'wait']),
  time('timer', 'Timer', ['Timer', Timer], ['timeout', 'stopwatch', 'deadline']),
  time('hourglass', 'Hourglass', ['Hourglass', Hourglass], ['waiting', 'ttl', 'expiry']),
  time('calendar', 'Calendar', ['Calendar', Calendar], ['date', 'schedule', 'day']),
  time('history', 'History', ['RotateCcwClock', RotateCcwClock], ['past', 'log', 'rewind']),
  object('smartphone', 'Phone', ['Smartphone', Smartphone], ['mobile', 'app', 'device']),
  object('package', 'Parcel', ['Package', Package], ['box', 'delivery', 'order']),
  object('ticket', 'Ticket', ['Ticket', Ticket], ['booking', 'seat', 'pass']),
  object('shopping_bag', 'Shopping bag', ['ShoppingBag', ShoppingBag], ['purchase', 'cart']),
  object('credit_card', 'Card', ['CreditCard', CreditCard], ['payment', 'checkout']),
  object('pizza', 'Pizza', ['Pizza', Pizza], ['food', 'order', 'delivery']),
  object('coffee', 'Coffee', ['Coffee', Coffee], ['cup', 'cafe', 'drink']),
  object('laptop', 'Laptop', ['Laptop', Laptop], ['computer', 'client', 'device']),
  object('receipt', 'Receipt', ['Receipt', Receipt], ['bill', 'invoice', 'order']),
  object('cash', 'Cash', ['Banknote', Banknote], ['money', 'payment', 'note']),
  object('photo', 'Photo', ['Image', Image], ['image', 'picture', 'upload']),
  object('video', 'Video', ['Video', Video], ['camera', 'stream', 'recording']),
  object('book', 'Book', ['BookOpen', BookOpen], ['docs', 'reading', 'manual']),
  object('gamepad', 'Gamepad', ['Gamepad2', Gamepad2], ['game', 'player', 'console']),
  object('shop', 'Shop', ['Store', Store], ['store', 'seller', 'merchant']),
  object('home', 'Home', ['House', House], ['house', 'address', 'origin']),
  transport('car', 'Car', ['Car', Car], ['ride', 'vehicle', 'driver']),
  transport('bike', 'Bike', ['Bike', Bike], ['rider', 'courier', 'cycle']),
  transport('truck', 'Truck', ['Truck', Truck], ['shipping', 'freight', 'delivery']),
  transport('plane', 'Plane', ['Plane', Plane], ['flight', 'travel', 'airline']),
  transport('map_pin', 'Location', ['MapPin', MapPin], ['place', 'address', 'pin']),
  transport('route', 'Route', ['Route', Route], ['path', 'directions', 'trip']),
  ui('mail', 'Message', ['Mail', Mail], ['email', 'envelope', 'notification']),
  ui('bell', 'Notification', ['Bell', Bell], ['alert', 'push', 'ping']),
  ui('chat', 'Chat', ['MessageSquare', MessageSquare], ['message', 'reply', 'prompt']),
  ui('monitor', 'Screen', ['Monitor', Monitor], ['display', 'desktop', 'dashboard']),
  ui('window', 'App window', ['AppWindow', AppWindow], ['browser', 'tab', 'page']),
  ui('pointer', 'Click', ['MousePointer2', MousePointer2], ['cursor', 'tap', 'select']),
  ui('settings', 'Settings', ['Settings', Settings], ['config', 'gear', 'options']),
  ui('refresh', 'Retry', ['RefreshCw', RefreshCw], ['reload', 'sync', 'refresh']),
  ui('gauge', 'Gauge', ['Gauge', Gauge], ['meter', 'speed', 'load']),
  symbol('crown', 'Leader', ['Crown', Crown], ['leader', 'primary', 'winner']),
  symbol('flag', 'Flag', ['Flag', Flag], ['marker', 'goal', 'milestone']),
  symbol('star', 'Star', ['Star', Star], ['favourite', 'rating', 'best']),
  symbol('check', 'Check', ['Check', Check], ['ok', 'done', 'yes']),
  symbol('x', 'Cross', ['X', X], ['no', 'wrong', 'fail']),
  symbol(
    'alert',
    'Warning',
    ['TriangleExclamationPoint', TriangleExclamationPoint],
    ['danger', 'caution', 'error'],
  ),
  symbol('zap', 'Fast', ['Zap', Zap], ['speed', 'instant', 'power']),
  symbol('success', 'Success', ['CircleCheck', CircleCheck], ['passed', 'ok', 'healthy']),
  symbol('failure', 'Failure', ['CircleX', CircleX], ['failed', 'error', 'down']),
  symbol('thumbs_up', 'Thumbs up', ['ThumbsUp', ThumbsUp], ['like', 'approve', 'good']),
  symbol('rocket', 'Launch', ['Rocket', Rocket], ['ship', 'deploy', 'start']),
  symbol('scale', 'Trade-off', ['Scale', Scale], ['balance', 'compare', 'weigh']),
  symbol('repeat', 'Loop', ['Repeat', Repeat], ['retry', 'cycle', 'again']),
  dev('code', 'Code', ['Code', Code], ['source', 'program', 'snippet']),
  dev('terminal', 'Terminal', ['Terminal', Terminal], ['shell', 'cli', 'command']),
  dev('git_branch', 'Git branch', ['GitBranch', GitBranch], ['version control', 'fork']),
  dev('bug', 'Bug', ['Bug', Bug], ['defect', 'error', 'issue']),
  dev('module', 'Software package', ['Blocks', Blocks], ['package', 'library', 'dependency']),
];

/** `HardDrive` → `hard-drive`, `Gamepad2` → `gamepad-2` (Lucide's file names). */
export function lucideFileName(exportName: string): string {
  return exportName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();
}

function toAsset(seed: SeedEntry): LibraryAsset {
  const file = lucideFileName(seed.lucide);
  return {
    kind: 'library',
    id: seed.id,
    name: seed.name,
    family: seed.family,
    tags: seed.tags,
    styleVersion: HOUSE_STYLE_VERSION,
    licence: FEATHER_DERIVED.has(file) ? 'ISC AND MIT' : 'ISC',
    source: `lucide@${LUCIDE_VERSION}:${file}`,
    shapes: restyleIconNode(seed.lucide, seed.node),
  };
}

/** Seed sources start with this; the studio updates only rows it seeded. */
export const SEED_SOURCE_PREFIX = 'lucide@';

export const SEED_ASSETS: readonly LibraryAsset[] = SEED_ENTRIES.map(toAsset);
